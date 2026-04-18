import path from "node:path";
import { analyzeHotspots } from "@/lib/analytics/hotspot";
import { queryEvents, queryRuns } from "@/lib/analytics/duckdb";
import { buildFailureArtifact } from "@/lib/adapters/contract";
import type { SourceArtifact } from "@/lib/adapters/types";
import { exportRunBundle, ingestAdvisoryFromFile, writeRunStateSnapshot } from "@/lib/bridge/cli-file";
import { sendDiscordNotifierFromFile } from "@/lib/bridge/discord-notifier";
import { exportLinkitIngestBundle } from "@/lib/bridge/linkit-export";
import { publishLinkitBatch } from "@/lib/bridge/linkit-publish";
import { WORKSPACE_ROOT } from "@/lib/config";
import { executeResearchRun, fetchWeb, gatherForRun } from "@/lib/orchestrator/run-research";
import { buildWatchDigest } from "@/lib/orchestrator/watch-digest";
import { promoteDigestToProject } from "@/lib/orchestrator/watch-inbox";
import { runSchedulerTick } from "@/lib/orchestrator/watch-scheduler";
import { triggerWatchTarget } from "@/lib/orchestrator/watch-runtime";
import {
  createRunRecord,
  listDigestRecords,
  listInboxItemRecords,
  listWatchTargetRecords,
  readDigestRecord,
  readProjectRecord,
  readRunRecord,
  readWatchTargetRecord,
  updateInboxItemStatus
} from "@/lib/storage/workspace";

type JsonRpcId = number | string | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

const MCP_PROTOCOL_VERSION = "2024-11-05";

const TOOLS: ToolDefinition[] = [
  {
    name: "get_project",
    description: "Read a project record from the local workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" }
      },
      required: ["projectId"]
    }
  },
  {
    name: "get_run",
    description: "Read a run record from the local workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" }
      },
      required: ["projectId", "runId"]
    }
  },
  {
    name: "show_run_state",
    description: "Write and return the current run-state snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" }
      },
      required: ["projectId", "runId"]
    }
  },
  {
    name: "run_research",
    description: "Create a run from MCP inputs, execute research, and return the resulting run record.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        query: { type: "string" },
        naturalLanguage: { type: "string" },
        pastedContent: { type: "string" },
        urls: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["projectId", "title"]
    }
  },
  {
    name: "fetch_web",
    description: "Fetch a single URL through the router and return one SourceArtifact. Never throws; failures return an artifact.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        opts: { type: "object" }
      },
      required: ["url"]
    }
  },
  {
    name: "gather_for_run",
    description: "Gather all URLs for a run within budget and return collected artifacts. Never throws; failures return artifacts.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" }
      },
      required: ["runId"]
    }
  },
  {
    name: "list_watch_targets",
    description: "List watch targets for a project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" }
      },
      required: ["projectId"]
    }
  },
  {
    name: "get_watch_target",
    description: "Read one watch target from the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        watchTargetId: { type: "string" }
      },
      required: ["projectId", "watchTargetId"]
    }
  },
  {
    name: "trigger_watch",
    description: "Trigger a watch target and return the created run.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        watchTargetId: { type: "string" }
      },
      required: ["projectId", "watchTargetId"]
    }
  },
  {
    name: "list_digests",
    description: "List digests for a project or watch target.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        watchTargetId: { type: "string" }
      },
      required: ["projectId"]
    }
  },
  {
    name: "get_digest",
    description: "Read one digest from the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        digestId: { type: "string" }
      },
      required: ["projectId", "digestId"]
    }
  },
  {
    name: "build_watch_digest",
    description: "Build one digest from watch-linked source runs.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        watchTargetId: { type: "string" },
        sourceRunIds: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["projectId", "watchTargetId", "sourceRunIds"]
    }
  },
  {
    name: "list_inbox",
    description: "List inbox items for a project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        status: {
          type: "string",
          enum: ["unread", "read", "archived", "promoted"]
        }
      },
      required: ["projectId"]
    }
  },
  {
    name: "archive_inbox_item",
    description: "Archive one inbox item in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        itemId: { type: "string" }
      },
      required: ["projectId", "itemId"]
    }
  },
  {
    name: "promote_digest_to_project",
    description: "Promote a digest into a normal project run.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        digestId: { type: "string" }
      },
      required: ["projectId", "digestId"]
    }
  },
  {
    name: "run_scheduler_tick",
    description: "Fire all due watch_target triggers based on interval schedule. Returns triggered + skipped.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" }
      }
    }
  },
  {
    name: "export_bundle",
    description: "Export bundle.json and bundle.md for a run.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" }
      },
      required: ["projectId", "runId"]
    }
  },
  {
    name: "export_linkit_ingest",
    description: "Export digest.txt, normalized-items.json, and linkit-ready-items.json for a run.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" }
      },
      required: ["projectId", "runId"]
    }
  },
  {
    name: "publish_linkit_batch",
    description: "Publish linkit-ready items to Linkit and write discord-notifier.json.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" },
        apiBaseUrl: { type: "string" },
        siteUrl: { type: "string" },
        actorEmail: { type: "string" }
      },
      required: ["projectId", "runId", "apiBaseUrl", "siteUrl", "actorEmail"]
    }
  },
  {
    name: "send_discord_notifier",
    description: "Send discord-notifier.json through a Discord webhook.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" },
        webhookUrl: { type: "string" }
      },
      required: ["projectId", "runId", "webhookUrl"]
    }
  },
  {
    name: "ingest_advisory",
    description: "Append advisory.json into the run record.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" },
        provider: { type: "string", enum: ["claude", "codex"] }
      },
      required: ["projectId", "runId", "provider"]
    }
  },
  {
    name: "query_events",
    description: "Query events.jsonl files through DuckDB. Use view name events.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string" }
      },
      required: ["sql"]
    }
  },
  {
    name: "query_runs",
    description: "Query run JSON records through DuckDB. Use view name runs.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string" }
      },
      required: ["sql"]
    }
  },
  {
    name: "analyze_hotspots",
    description: "Analyze a git repo for high-risk files by combining churn frequency and cyclomatic complexity. Returns files ranked by hotspot_score (churn × avg_ccn). Accepts a local absolute path OR a remote git URL (https/git@) — remote repos are auto-cloned. Use before modifying files to identify risk.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string", description: "Absolute local path to git repo, OR a remote git URL (https://... or git@...)" },
        since: { type: "string", description: "Git date range, e.g. '12.month', '6.month', '1.year'. Default: 12.month" },
        limit: { type: "number", description: "Number of top hotspot files to return. Default: 20" }
      },
      required: ["repoPath"]
    }
  }
];

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message }
  };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${name} must be a non-empty string array`);
  }
  return value;
}

function toToolResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

function summarizeArtifacts(artifacts: SourceArtifact[]) {
  return artifacts.slice(0, 3).map((artifact) => ({
    id: artifact.id,
    title: artifact.title,
    url: artifact.url,
    adapter: artifact.adapter,
    sourceType: artifact.sourceType,
    fetchStatus: artifact.metadata.fetch_status,
    snippet: artifact.snippet
  }));
}

function buildRecommendedNextTools(status: string) {
  if (status === "awaiting_clarification") {
    return ["get_run", "run_research"];
  }
  if (status === "decided") {
    return ["show_run_state", "export_bundle", "get_run"];
  }
  if (status === "failed") {
    return ["get_run"];
  }
  return ["show_run_state", "get_run"];
}

function buildRunBridgePaths(projectId: string, runId: string) {
  const bridgeDir = path.join(WORKSPACE_ROOT, projectId, "runs", runId, "bridge");
  return {
    bridgeDir,
    bundlePath: path.join(bridgeDir, "bundle.md"),
    snapshotPath: path.join(bridgeDir, "run-state.json")
  };
}

function withMcpSummary(record: Awaited<ReturnType<typeof executeResearchRun>>) {
  const paths = buildRunBridgePaths(record.run.projectId, record.run.id);
  return {
    ...record,
    mcpSummary: {
      runId: record.run.id,
      status: record.run.status,
      decision: record.decision
        ? {
            value: record.decision.value,
            confidence: record.decision.confidence,
            why: record.decision.why
          }
        : null,
      clarificationQuestions: record.run.clarificationQuestions,
      topArtifacts: summarizeArtifacts(record.artifacts),
      paths,
      recommendedNextTools: buildRecommendedNextTools(record.run.status)
    }
  };
}

function buildMcpFailureArtifact(params: {
  adapter: "mcp/fetch_web" | "mcp/gather_for_run";
  url?: string;
  errorMessage: string;
}) {
  return buildFailureArtifact({
    id: `${params.adapter}-0`,
    adapter: params.adapter,
    fetcher: params.adapter,
    url: params.url ?? "",
    sourceType: "web",
    outcome: { status: "error" },
    errorMessage: params.errorMessage,
    sourceLabel: "web/error"
  });
}

async function callTool(
  name: string,
  args: Record<string, unknown> | undefined,
  deps?: {
    executeResearchRun?: typeof executeResearchRun;
    fetchWeb?: typeof fetchWeb;
    gatherForRun?: typeof gatherForRun;
    triggerWatch?: typeof triggerWatchTarget;
    buildWatchDigest?: typeof buildWatchDigest;
    promoteDigestToProject?: typeof promoteDigestToProject;
    runSchedulerTick?: typeof runSchedulerTick;
  }
) {
  const projectId = args?.projectId;
  const runId = args?.runId;
  const executeResearchRunFn = deps?.executeResearchRun ?? executeResearchRun;
  const fetchWebFn = deps?.fetchWeb ?? fetchWeb;
  const gatherForRunFn = deps?.gatherForRun ?? gatherForRun;
  const triggerWatchFn = deps?.triggerWatch ?? triggerWatchTarget;
  const buildWatchDigestFn = deps?.buildWatchDigest ?? buildWatchDigest;
  const promoteDigestToProjectFn =
    deps?.promoteDigestToProject ?? promoteDigestToProject;
  const runSchedulerTickFn = deps?.runSchedulerTick ?? runSchedulerTick;

  switch (name) {
    case "get_project": {
      const record = await readProjectRecord(requireString(projectId, "projectId"));
      return toToolResult(record);
    }
    case "get_run": {
      const record = await readRunRecord(
        requireString(projectId, "projectId"),
        requireString(runId, "runId")
      );
      return toToolResult(record);
    }
    case "show_run_state": {
      const snapshotPath = await writeRunStateSnapshot(
        requireString(projectId, "projectId"),
        requireString(runId, "runId")
      );
      return toToolResult({ projectId, runId, snapshotPath });
    }
    case "run_research": {
      const createdRun = await createRunRecord(requireString(projectId, "projectId"), {
        title: requireString(args?.title, "title"),
        naturalLanguage: optionalString(args?.query) ?? optionalString(args?.naturalLanguage),
        pastedContent: optionalString(args?.pastedContent),
        urls: optionalStringArray(args?.urls, "urls")
      });
      const record = await executeResearchRunFn(createdRun.run.projectId, createdRun.run.id);
      return toToolResult(withMcpSummary(record));
    }
    case "fetch_web": {
      const url = requireString(args?.url, "url");
      try {
        return toToolResult(await fetchWebFn(url));
      } catch (error) {
        return toToolResult(
          buildMcpFailureArtifact({
            adapter: "mcp/fetch_web",
            url,
            errorMessage: error instanceof Error ? error.message : String(error)
          })
        );
      }
    }
    case "gather_for_run": {
      const targetRunId = requireString(args?.runId, "runId");
      try {
        return toToolResult({
          runId: targetRunId,
          artifacts: await gatherForRunFn(targetRunId)
        });
      } catch (error) {
        return toToolResult({
          runId: targetRunId,
          artifacts: [
            buildMcpFailureArtifact({
              adapter: "mcp/gather_for_run",
              errorMessage: error instanceof Error ? error.message : String(error)
            })
          ]
        });
      }
    }
    case "list_watch_targets": {
      const records = await listWatchTargetRecords(requireString(projectId, "projectId"));
      return toToolResult({ projectId, watchTargets: records });
    }
    case "get_watch_target": {
      const record = await readWatchTargetRecord(
        requireString(projectId, "projectId"),
        requireString(args?.watchTargetId, "watchTargetId")
      );
      return toToolResult(record);
    }
    case "trigger_watch": {
      const record = await triggerWatchFn(
        requireString(projectId, "projectId"),
        requireString(args?.watchTargetId, "watchTargetId")
      );
      return toToolResult(record);
    }
    case "list_digests": {
      const targetProjectId = requireString(projectId, "projectId");
      const watchTargetId =
        typeof args?.watchTargetId === "string" && args.watchTargetId.length > 0
          ? args.watchTargetId
          : undefined;
      const digests = await listDigestRecords(targetProjectId);
      return toToolResult({
        projectId: targetProjectId,
        digests: watchTargetId
          ? digests.filter((digest) => digest.watchTargetId === watchTargetId)
          : digests
      });
    }
    case "get_digest": {
      const record = await readDigestRecord(
        requireString(projectId, "projectId"),
        requireString(args?.digestId, "digestId")
      );
      return toToolResult(record);
    }
    case "build_watch_digest": {
      const record = await buildWatchDigestFn(
        requireString(projectId, "projectId"),
        requireString(args?.watchTargetId, "watchTargetId"),
        {
          sourceRunIds: requireStringArray(args?.sourceRunIds, "sourceRunIds")
        }
      );
      return toToolResult(record);
    }
    case "list_inbox": {
      const targetProjectId = requireString(projectId, "projectId");
      const status =
        typeof args?.status === "string" && args.status.length > 0
          ? args.status
          : undefined;
      if (
        status &&
        status !== "unread" &&
        status !== "read" &&
        status !== "archived" &&
        status !== "promoted"
      ) {
        throw new Error("status must be unread, read, archived, or promoted");
      }
      const items = await listInboxItemRecords(targetProjectId);
      return toToolResult({
        projectId: targetProjectId,
        inboxItems: status ? items.filter((item) => item.status === status) : items
      });
    }
    case "archive_inbox_item": {
      const record = await updateInboxItemStatus(
        requireString(projectId, "projectId"),
        requireString(args?.itemId, "itemId"),
        "archived"
      );
      return toToolResult(record);
    }
    case "promote_digest_to_project": {
      const record = await promoteDigestToProjectFn(
        requireString(projectId, "projectId"),
        requireString(args?.digestId, "digestId")
      );
      return toToolResult(record);
    }
    case "run_scheduler_tick": {
      const targetProjectId =
        typeof projectId === "string" && projectId.length > 0 ? projectId : undefined;
      return toToolResult(
        await runSchedulerTickFn({
          projectId: targetProjectId
        })
      );
    }
    case "export_bundle": {
      const bundleDir = await exportRunBundle(
        requireString(projectId, "projectId"),
        requireString(runId, "runId")
      );
      return toToolResult({ projectId, runId, bundleDir });
    }
    case "export_linkit_ingest": {
      const result = await exportLinkitIngestBundle(
        requireString(projectId, "projectId"),
        requireString(runId, "runId")
      );
      return toToolResult(result);
    }
    case "publish_linkit_batch": {
      const result = await publishLinkitBatch(
        requireString(projectId, "projectId"),
        requireString(runId, "runId"),
        {
          apiBaseUrl: requireString(args?.apiBaseUrl, "apiBaseUrl"),
          siteUrl: requireString(args?.siteUrl, "siteUrl"),
          actorEmail: requireString(args?.actorEmail, "actorEmail")
        }
      );
      return toToolResult(result);
    }
    case "send_discord_notifier": {
      const result = await sendDiscordNotifierFromFile(
        requireString(projectId, "projectId"),
        requireString(runId, "runId"),
        {
          webhookUrl: requireString(args?.webhookUrl, "webhookUrl")
        }
      );
      return toToolResult(result);
    }
    case "ingest_advisory": {
      const provider = requireString(args?.provider, "provider");
      if (provider !== "claude" && provider !== "codex") {
        throw new Error("provider must be claude or codex");
      }
      await ingestAdvisoryFromFile(
        requireString(projectId, "projectId"),
        requireString(runId, "runId"),
        provider
      );
      return toToolResult({ projectId, runId, provider, ingested: true });
    }
    case "query_events":
      return toToolResult({ rows: await queryEvents(requireString(args?.sql, "sql")) });
    case "query_runs":
      return toToolResult({ rows: await queryRuns(requireString(args?.sql, "sql")) });
    case "analyze_hotspots": {
      const repoPath = requireString(args?.repoPath, "repoPath");
      const since = typeof args?.since === "string" ? args.since : "12.month";
      const limit = typeof args?.limit === "number" ? args.limit : 20;
      const rows = await analyzeHotspots(repoPath, since, limit);
      return toToolResult({ repoPath, since, limit, rows });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function createMcpHandler(deps?: {
  executeResearchRun?: typeof executeResearchRun;
  fetchWeb?: typeof fetchWeb;
  gatherForRun?: typeof gatherForRun;
  triggerWatch?: typeof triggerWatchTarget;
  buildWatchDigest?: typeof buildWatchDigest;
  promoteDigestToProject?: typeof promoteDigestToProject;
  runSchedulerTick?: typeof runSchedulerTick;
}) {
  return async function handleMcpRequest(
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse | null> {
    const id = request.id ?? null;

    try {
      switch (request.method) {
        case "initialize":
          return ok(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: "decision-engine",
              version: "0.1.0"
            }
          });
        case "notifications/initialized":
          return null;
        case "ping":
          return ok(id, {});
        case "tools/list":
          return ok(id, { tools: TOOLS });
        case "tools/call": {
          const name = requireString(request.params?.name, "name");
          const args =
            request.params?.arguments && typeof request.params.arguments === "object"
              ? (request.params.arguments as Record<string, unknown>)
              : {};
          return ok(id, await callTool(name, args, deps));
        }
        default:
          return fail(id, -32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      return fail(id, -32000, error instanceof Error ? error.message : "Unknown MCP error");
    }
  };
}

export const handleMcpRequest = createMcpHandler();
