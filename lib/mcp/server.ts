import { exportRunBundle, ingestAdvisoryFromFile, writeRunStateSnapshot } from "@/lib/bridge/cli-file";
import { queryEvents, queryRuns } from "@/lib/analytics/duckdb";
import { analyzeHotspots } from "@/lib/analytics/hotspot";
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

async function callTool(name: string, args: Record<string, unknown> | undefined) {
  const projectId = args?.projectId;
  const runId = args?.runId;

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
    case "export_bundle": {
      const bundleDir = await exportRunBundle(
        requireString(projectId, "projectId"),
        requireString(runId, "runId")
      );
      return toToolResult({ projectId, runId, bundleDir });
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

export async function handleMcpRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
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
        return ok(id, await callTool(name, args));
      }
      default:
        return fail(id, -32601, `Method not found: ${request.method}`);
    }
  } catch (error) {
    return fail(id, -32000, error instanceof Error ? error.message : "Unknown MCP error");
  }
}
