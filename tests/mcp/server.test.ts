import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceArtifact } from "@/lib/adapters/types";

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
      "export_linkit_ingest",
      "publish_linkit_batch",
      "send_discord_notifier",
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

  it("exports linkit ingest files from run artifacts", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "decision-engine-mcp-"));
    process.env.WORKSPACE_ROOT = tempRoot;
    vi.resetModules();

    const { createProjectRecord, createRunRecord, updateRunRecord } = await import("@/lib/storage/workspace");
    const { handleMcpRequest } = await import("@/lib/mcp/server");

    const project = await createProjectRecord({
      name: "Decision Engine",
      description: "AI-first"
    });
    const run = await createRunRecord(project.project.id, {
      title: "링킷 적재",
      naturalLanguage: "링킷 적재용 run"
    });

    const artifacts: SourceArtifact[] = [
      {
        id: "artifact-github",
        adapter: "agent-reach",
        sourceType: "github",
        title: "OpenAI Codex Plugin 관련 저장소가 참고 후보로 수집됐다",
        url: "https://github.com/openai/codex-plugin",
        snippet: "Codex Plugin 관련 저장소로 참고 가치가 높다.",
        content: "",
        sourcePriority: "analysis",
        publishedAt: "2026-03-31T00:29:00.000Z",
        metadata: {
          stars: "13505",
          repo_name: "openai/codex-plugin"
        }
      }
    ];

    await updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      artifacts
    }));

    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "export_linkit_ingest",
        arguments: {
          projectId: project.project.id,
          runId: run.run.id
        }
      }
    });

    const result = (response as { result: { structuredContent: { normalizedCount: number; readyCount: number } } }).result;
    expect(result.structuredContent.normalizedCount).toBe(1);
    expect(result.structuredContent.readyCount).toBe(1);
  });

  it("publishes a linkit batch through MCP", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "decision-engine-mcp-"));
    process.env.WORKSPACE_ROOT = tempRoot;
    vi.resetModules();

    const { createProjectRecord, createRunRecord, updateRunRecord } = await import("@/lib/storage/workspace");
    const { handleMcpRequest } = await import("@/lib/mcp/server");

    const project = await createProjectRecord({
      name: "Decision Engine",
      description: "AI-first"
    });
    const run = await createRunRecord(project.project.id, {
      title: "링킷 발행",
      naturalLanguage: "링킷 발행용 run"
    });

    const artifacts: SourceArtifact[] = [
      {
        id: "artifact-x",
        adapter: "agent-reach",
        sourceType: "web",
        title: "Claude Code 토큰 사용량 문제를 추적하고 우회한 사례가 공유됐다",
        url: "https://x.com/midudev/status/123",
        snippet: "Claude Code 사용 중 토큰 과소비 문제를 추적하고 우회한 사례",
        content: "",
        sourcePriority: "analysis",
        metadata: {
          source_type: "x",
          like_count: "1814",
          author_handle: "@midudev",
          category: "claude-code"
        }
      }
    ];

    await updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      artifacts
    }));

    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          published: 1,
          items: [
            { id: "link_1", title: "Claude Code 토큰 사용량 문제를 추적하고 우회한 사례", category: "claude-code" }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    ) as typeof fetch;

    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "publish_linkit_batch",
        arguments: {
          projectId: project.project.id,
          runId: run.run.id,
          apiBaseUrl: "https://linkit.test",
          siteUrl: "https://linkit.site",
          actorEmail: "ops@example.com"
        }
      }
    });

    const result = (response as { result: { structuredContent: { published: number; notifierPath: string } } }).result;
    expect(result.structuredContent.published).toBe(1);
    expect(result.structuredContent.notifierPath).toContain("discord-notifier.json");
  });

  it("sends a discord notifier through MCP", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "decision-engine-mcp-"));
    process.env.WORKSPACE_ROOT = tempRoot;
    vi.resetModules();

    const { mkdir, writeFile } = await import("node:fs/promises");
    const { handleMcpRequest } = await import("@/lib/mcp/server");

    const bridgeDir = path.join(tempRoot, "project-1", "runs", "run-1", "bridge");
    await mkdir(bridgeDir, { recursive: true });
    await writeFile(
      path.join(bridgeDir, "discord-notifier.json"),
      JSON.stringify({
        source: "linkit-publish",
        version: "2026-04-13",
        published_at: "2026-04-13T10:00:00.000Z",
        site_url: "https://linkit.site",
        counts: { published: 1, today: 1, github: 0 },
        highlights: ["오늘의 추천 1개 갱신"],
        top_items: []
      }, null, 2),
      "utf8"
    );

    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "discord-msg-1"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    ) as typeof fetch;

    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "send_discord_notifier",
        arguments: {
          projectId: "project-1",
          runId: "run-1",
          webhookUrl: "https://discord.com/api/webhooks/test"
        }
      }
    });

    const result = (response as { result: { structuredContent: { webhookMessageId: string | null; resultPath: string } } }).result;
    expect(result.structuredContent.webhookMessageId).toBe("discord-msg-1");
    expect(result.structuredContent.resultPath).toContain("discord-send-result.json");
  });
});
