import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let tempRoot: string | null = null;

describe("mcp server", () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    delete process.env.WORKSPACE_ROOT;
  });

  it("responds to initialize with tools capability", async () => {
    const { handleMcpRequest } = await import("@/lib/mcp/server");

    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "test-client",
          version: "1.0.0"
        }
      }
    });

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "decision-engine"
        }
      }
    });
  });

  it("lists the minimum AI-first tools", async () => {
    const { handleMcpRequest } = await import("@/lib/mcp/server");

    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list"
    });

    const tools = (response as { result: { tools: Array<{ name: string }> } }).result.tools;

    expect(tools.map((tool) => tool.name)).toEqual([
      "get_project",
      "get_run",
      "show_run_state",
      "export_bundle",
      "ingest_advisory",
      "query_events",
      "query_runs",
      "analyze_hotspots"
    ]);
  });

  it("calls get_run and returns structured content", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "decision-engine-mcp-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const { createProjectRecord, createRunRecord } = await import("@/lib/storage/workspace");
    const { handleMcpRequest } = await import("@/lib/mcp/server");

    const project = await createProjectRecord({
      name: "Decision Engine",
      description: "AI-first"
    });
    const run = await createRunRecord(project.project.id, {
      title: "시장 진입 판단",
      naturalLanguage: "시장 진입 여부 판단"
    });

    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_run",
        arguments: {
          projectId: project.project.id,
          runId: run.run.id
        }
      }
    });

    const result = (response as { result: { structuredContent: { run: { id: string } } } }).result;

    expect(result.structuredContent.run.id).toBe(run.run.id);
  });

  it("calls query_events and returns grouped counts", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "decision-engine-mcp-"));
    process.env.WORKSPACE_ROOT = tempRoot;
    vi.resetModules();

    const { createProjectRecord, createRunRecord } = await import("@/lib/storage/workspace");
    const { appendRunEvent } = await import("@/lib/bridge/cli-file");
    const { handleMcpRequest } = await import("@/lib/mcp/server");

    const project = await createProjectRecord({
      name: "Decision Engine",
      description: "AI-first"
    });
    const run = await createRunRecord(project.project.id, {
      title: "시장 진입 판단",
      naturalLanguage: "시장 진입 여부 판단"
    });

    await appendRunEvent(project.project.id, run.run.id, {
      type: "bundle_exported",
      detail: {
        provider: "claude"
      },
      at: "2026-04-10T00:00:00.000Z"
    });

    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "query_events",
        arguments: {
          sql: "SELECT type, COUNT(*)::BIGINT AS count FROM events GROUP BY type"
        }
      }
    });

    const result = (response as { result: { structuredContent: { rows: Array<{ type: string; count: number }> } } }).result;

    expect(result.structuredContent.rows).toEqual([
      {
        type: "bundle_exported",
        count: 1
      }
    ]);
  });
});
