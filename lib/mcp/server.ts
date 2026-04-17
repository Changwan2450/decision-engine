import { analyzeHotspots } from "@/lib/analytics/hotspot";
import { queryEvents, queryRuns } from "@/lib/analytics/duckdb";
import { buildFailureArtifact } from "@/lib/adapters/contract";
import { exportRunBundle, ingestAdvisoryFromFile, writeRunStateSnapshot } from "@/lib/bridge/cli-file";
import { sendDiscordNotifierFromFile } from "@/lib/bridge/discord-notifier";
import { exportLinkitIngestBundle } from "@/lib/bridge/linkit-export";
import { publishLinkitBatch } from "@/lib/bridge/linkit-publish";
import { fetchWeb, gatherForRun } from "@/lib/orchestrator/run-research";
import { readProjectRecord, readRunRecord } from "@/lib/storage/workspace";

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
    fetchWeb?: typeof fetchWeb;
    gatherForRun?: typeof gatherForRun;
  }
) {
  const projectId = args?.projectId;
  const runId = args?.runId;
  const fetchWebFn = deps?.fetchWeb ?? fetchWeb;
  const gatherForRunFn = deps?.gatherForRun ?? gatherForRun;

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
  fetchWeb?: typeof fetchWeb;
  gatherForRun?: typeof gatherForRun;
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
