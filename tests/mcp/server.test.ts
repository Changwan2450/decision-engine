import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceArtifact } from "@/lib/adapters/types";

let tempRoot: string | null = null;

async function setupTempWorkspace() {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "decision-engine-mcp-"));
  process.env.WORKSPACE_ROOT = tempRoot;
  vi.resetModules();
}

async function callTool(name: string, args: Record<string, unknown>) {
  const { handleMcpRequest } = await import("@/lib/mcp/server");
  return callToolWithHandler(handleMcpRequest, name, args);
}

async function callToolWithHandler(
  handleMcpRequest: (request: {
    jsonrpc: "2.0";
    id: number;
    method: "tools/call";
    params: {
      name: string;
      arguments: Record<string, unknown>;
    };
  }) => Promise<unknown>,
  name: string,
  args: Record<string, unknown>
) {
  return handleMcpRequest({
    jsonrpc: "2.0",
    id: 100,
    method: "tools/call",
    params: {
      name,
      arguments: args
    }
  });
}

async function createWatchFixture() {
  const workspace = await import("@/lib/storage/workspace");
  const project = await workspace.createProjectRecord({
    name: "Watchable",
    description: "watch mcp test"
  });
  const watchTarget = await workspace.createWatchTargetRecord(project.project.id, {
    title: "Short-form watch",
    naturalLanguage: "track short-form creator signals"
  });

  return {
    workspace,
    project,
    watchTarget
  };
}

describe("mcp server", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
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

  it("lists the current MCP tools including watch tools", async () => {
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
      "run_research",
      "clarify_run",
      "suggest_followup_run",
      "fetch_web",
      "gather_for_run",
      "list_watch_targets",
      "get_watch_target",
      "trigger_watch",
      "list_digests",
      "get_digest",
      "build_watch_digest",
      "list_inbox",
      "archive_inbox_item",
      "promote_digest_to_project",
      "run_scheduler_tick",
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
    await setupTempWorkspace();

    const { createProjectRecord, createRunRecord } = await import("@/lib/storage/workspace");
    const project = await createProjectRecord({
      name: "Decision Engine",
      description: "AI-first"
    });
    const run = await createRunRecord(project.project.id, {
      title: "시장 진입 판단",
      naturalLanguage: "시장 진입 여부 판단"
    });

    const response = await callTool("get_run", {
      projectId: project.project.id,
      runId: run.run.id
    });

    const result = (response as { result: { structuredContent: { run: { id: string } } } }).result;

    expect(result.structuredContent.run.id).toBe(run.run.id);
  });

  it("creates and executes a run through run_research", async () => {
    await setupTempWorkspace();

    const workspace = await import("@/lib/storage/workspace");
    const { createMcpHandler } = await import("@/lib/mcp/server");
    const project = await workspace.createProjectRecord({
      name: "Decision Engine",
      description: "AI-first"
    });

    const handleMcpRequest = createMcpHandler({
      executeResearchRun: async (projectId, runId) =>
        workspace.updateRunRecord(projectId, runId, (record) => ({
          ...record,
          normalizedInput: {
            title: record.run.title,
            naturalLanguage: record.run.input.naturalLanguage ?? "",
            pastedContent: record.run.input.pastedContent ?? "",
            urls: record.run.input.urls,
            goal: "판단",
            target: "시장",
            comparisonAxis: "대안"
          },
          expansion: {
            expanded: [
              {
                axis: "official",
                query: "시장 진입 판단",
                source: "jina-search",
                url: "https://s.jina.ai/?q=%EC%8B%9C%EC%9E%A5+%EC%A7%84%EC%9E%85+%ED%8C%90%EB%8B%A8"
              }
            ],
            dropped: 2
          },
          artifacts: [
            {
              id: "artifact-1",
              adapter: "scrapling",
              sourceType: "web",
              title: "시장 보고서",
              url: "https://example.com/report",
              snippet: "시장 신호 요약",
              content: "body",
              sourcePriority: "analysis",
              sourceTier: "community",
              metadata: {
                fetcher: "scrapling",
                fetch_status: "success",
                block_reason: "unknown",
                bypass_level: "none",
                login_required: "false"
              }
            }
          ],
          contradictions: [
            {
              id: "contradiction-0",
              claimIds: ["claim-0", "claim-1"],
              status: "flagged",
              resolution: "unresolved",
              kind: "official_vs_community",
              tierA: "official",
              tierB: "community"
            }
          ],
          decision: {
            value: "go",
            confidence: "high",
            why: "시장 진입 신호가 충분함",
            blockingUnknowns: [],
            nextActions: ["bundle 확인"]
          },
          run: {
            ...record.run,
            status: "decided"
          }
        }))
    });

    const response = await callToolWithHandler(handleMcpRequest, "run_research", {
      projectId: project.project.id,
      title: "시장 진입 판단",
      query: "시장 진입 여부 판단",
      urls: ["https://example.com/report"]
    });

    const result = (response as { result: { structuredContent: { run: { id: string; status: string; input: { urls: string[] } }; normalizedInput: { naturalLanguage: string }; mcpSummary: { runId: string; status: string; decision: { value: string; confidence: string }; topArtifacts: Array<{ title: string; sourceTier: string }>; tierDistribution: { official: number; primary: number; internal: number; community: number; aggregator: number; unknown: number }; contradictionSignals: Array<{ id: string; kind: string; tierA: string; tierB: string; reason: string; followupAvailable: boolean }>; paths: { bundlePath: string; snapshotPath: string }; recommendedNextTools: string[]; nextToolCall: { name: string; arguments: { projectId: string; runId: string } }; clarificationTemplate: null; expandedQueries: Array<{ axis: string; source: string; url: string }>; expansionDropped: number } } } }).result;
    const stored = await workspace.readRunRecord(project.project.id, result.structuredContent.run.id);

    expect(result.structuredContent.run.status).toBe("decided");
    expect(result.structuredContent.normalizedInput.naturalLanguage).toBe("시장 진입 여부 판단");
    expect(stored.run.input.urls).toEqual(["https://example.com/report"]);
    expect(result.structuredContent.mcpSummary.runId).toBe(result.structuredContent.run.id);
    expect(result.structuredContent.mcpSummary.status).toBe("decided");
    expect(result.structuredContent.mcpSummary.decision).toMatchObject({
      value: "go",
      confidence: "high"
    });
    expect(result.structuredContent.mcpSummary.topArtifacts[0]?.title).toBe("시장 보고서");
    expect(result.structuredContent.mcpSummary.topArtifacts[0]?.sourceTier).toBe("community");
    expect(result.structuredContent.mcpSummary.tierDistribution).toEqual({
      official: 0,
      primary: 0,
      internal: 0,
      community: 1,
      aggregator: 0,
      unknown: 0
    });
    expect(result.structuredContent.mcpSummary.contradictionSignals).toEqual([
      {
        id: "contradiction-0",
        kind: "official_vs_community",
        tierA: "official",
        tierB: "community",
        reason: "공식 문서와 커뮤니티 경험 충돌. 실 사용 시나리오 확인 필요.",
        followupAvailable: true
      }
    ]);
    expect(result.structuredContent.mcpSummary.paths.bundlePath).toContain(`${project.project.id}/runs/${result.structuredContent.run.id}/bridge/bundle.md`);
    expect(result.structuredContent.mcpSummary.paths.snapshotPath).toContain(`${project.project.id}/runs/${result.structuredContent.run.id}/bridge/run-state.json`);
    expect(result.structuredContent.mcpSummary.recommendedNextTools).toEqual([
      "show_run_state",
      "export_bundle",
      "get_run"
    ]);
    expect(result.structuredContent.mcpSummary.nextToolCall).toEqual({
      name: "show_run_state",
      arguments: {
        projectId: project.project.id,
        runId: result.structuredContent.run.id
      }
    });
    expect(result.structuredContent.mcpSummary.clarificationTemplate).toBeNull();
    expect(result.structuredContent.mcpSummary.expandedQueries).toEqual([
      {
        axis: "official",
        query: "시장 진입 판단",
        source: "jina-search",
        url: "https://s.jina.ai/?q=%EC%8B%9C%EC%9E%A5+%EC%A7%84%EC%9E%85+%ED%8C%90%EB%8B%A8"
      }
    ]);
    expect(result.structuredContent.mcpSummary.expansionDropped).toBe(2);
    expect(stored.artifacts[0]?.sourceTier).toBe(
      result.structuredContent.mcpSummary.topArtifacts[0]?.sourceTier
    );
  });

  it("reports kb.local artifacts as internal in tier distribution", async () => {
    await setupTempWorkspace();

    const workspace = await import("@/lib/storage/workspace");
    const { createMcpHandler } = await import("@/lib/mcp/server");
    const project = await workspace.createProjectRecord({
      name: "Decision Engine",
      description: "AI-first"
    });

    const handleMcpRequest = createMcpHandler({
      executeResearchRun: async (projectId, runId) =>
        workspace.updateRunRecord(projectId, runId, (record) => ({
          ...record,
          normalizedInput: {
            title: record.run.title,
            naturalLanguage: record.run.input.naturalLanguage ?? "",
            pastedContent: record.run.input.pastedContent ?? "",
            urls: record.run.input.urls,
            goal: "판단",
            target: "시장",
            comparisonAxis: "대안"
          },
          artifacts: [
            {
              id: "artifact-kb",
              adapter: "kb-preread",
              sourceType: "kb",
              title: "KB Wiki Prior",
              url: "https://kb.local/wiki/run-1",
              snippet: "internal prior",
              content: "body",
              sourcePriority: "analysis",
              sourceTier: "internal",
              metadata: {
                fetcher: "kb-preread",
                fetch_status: "success",
                block_reason: "unknown",
                bypass_level: "none",
                login_required: "false"
              }
            }
          ],
          decision: {
            value: "go",
            confidence: "high",
            why: "내부 prior가 있음",
            blockingUnknowns: [],
            nextActions: []
          },
          run: {
            ...record.run,
            status: "decided"
          }
        }))
    });

    const response = await callToolWithHandler(handleMcpRequest, "run_research", {
      projectId: project.project.id,
      title: "내부 KB 점검",
      query: "kb.local 내부 prior 확인"
    });

    const result = (response as { result: { structuredContent: { mcpSummary: { topArtifacts: Array<{ sourceTier: string }>; tierDistribution: { official: number; primary: number; internal: number; community: number; aggregator: number; unknown: number } } } } }).result;

    expect(result.structuredContent.mcpSummary.topArtifacts[0]?.sourceTier).toBe("internal");
    expect(result.structuredContent.mcpSummary.tierDistribution).toEqual({
      official: 0,
      primary: 0,
      internal: 1,
      community: 0,
      aggregator: 0,
      unknown: 0
    });
  });

  it("clarifies an existing run and re-executes on the same runId", async () => {
    await setupTempWorkspace();

    const workspace = await import("@/lib/storage/workspace");
    const { createMcpHandler } = await import("@/lib/mcp/server");
    const project = await workspace.createProjectRecord({
      name: "Decision Engine",
      description: "AI-first"
    });
    const run = await workspace.createRunRecord(project.project.id, {
      title: "시장 진입 판단",
      naturalLanguage: "초기 질문",
      urls: ["https://example.com/original"]
    });

    await workspace.updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      run: {
        ...record.run,
        status: "awaiting_clarification",
        clarificationQuestions: ["이번 리서치로 무엇을 결정하려는지 알려줘."]
      }
    }));

    const handleMcpRequest = createMcpHandler({
      executeResearchRun: async (projectId, runId) =>
        workspace.updateRunRecord(projectId, runId, (record) => ({
          ...record,
          normalizedInput: {
            title: record.run.title,
            naturalLanguage: record.run.input.naturalLanguage ?? "",
            pastedContent: record.run.input.pastedContent ?? "",
            urls: record.run.input.urls,
            goal: "진입 여부 결정",
            target: "신규 시장",
            comparisonAxis: "기존 채널"
          },
          artifacts: [
            {
              id: "artifact-clarified",
              adapter: "agent-reach",
              sourceType: "web",
              title: "보강된 시장 근거",
              url: "https://example.com/updated",
              snippet: "보강된 근거 요약",
              content: "body",
              sourcePriority: "analysis",
              metadata: {
                fetcher: "agent-reach",
                fetch_status: "success",
                block_reason: "unknown",
                bypass_level: "none",
                login_required: "false"
              }
            }
          ],
          decision: {
            value: "go",
            confidence: "high",
            why: "보강 입력 후 기준이 충족됨",
            blockingUnknowns: [],
            nextActions: ["bundle 확인"]
          },
          run: {
            ...record.run,
            status: "decided",
            clarificationQuestions: []
          }
        }))
    });

    const response = await callToolWithHandler(handleMcpRequest, "clarify_run", {
      projectId: project.project.id,
      runId: run.run.id,
      query: "목표: 진입 여부 결정\n대상: 신규 시장\n비교: 기존 채널",
      urls: ["https://example.com/updated"]
    });

    const result = (response as { result: { structuredContent: { run: { id: string; status: string; input: { naturalLanguage?: string; urls: string[] } }; mcpSummary: { runId: string; status: string; topArtifacts: Array<{ title: string }> } } } }).result;
    const stored = await workspace.readRunRecord(project.project.id, run.run.id);

    expect(result.structuredContent.run.id).toBe(run.run.id);
    expect(result.structuredContent.run.status).toBe("decided");
    expect(result.structuredContent.run.input.naturalLanguage).toContain("목표: 진입 여부 결정");
    expect(result.structuredContent.run.input.urls).toEqual(["https://example.com/updated"]);
    expect(stored.run.id).toBe(run.run.id);
    expect(stored.run.input.urls).toEqual(["https://example.com/updated"]);
    expect(result.structuredContent.mcpSummary.runId).toBe(run.run.id);
    expect(result.structuredContent.mcpSummary.status).toBe("decided");
    expect(result.structuredContent.mcpSummary.topArtifacts[0]?.title).toBe("보강된 시장 근거");
  });

  it("recommends clarify_run when a run is awaiting clarification", async () => {
    await setupTempWorkspace();

    const workspace = await import("@/lib/storage/workspace");
    const { createMcpHandler } = await import("@/lib/mcp/server");
    const project = await workspace.createProjectRecord({
      name: "Decision Engine",
      description: "AI-first"
    });

    const handleMcpRequest = createMcpHandler({
      executeResearchRun: async (projectId, runId) =>
        workspace.updateRunRecord(projectId, runId, (record) => ({
          ...record,
          run: {
            ...record.run,
            status: "awaiting_clarification",
            clarificationQuestions: ["무엇을 결정하려는지 알려줘."]
          },
          normalizedInput: {
            title: record.run.title,
            naturalLanguage: record.run.input.naturalLanguage ?? "",
            pastedContent: record.run.input.pastedContent ?? "",
            urls: record.run.input.urls
          }
        }))
    });

    const response = await callToolWithHandler(handleMcpRequest, "run_research", {
      projectId: project.project.id,
      title: "시장 진입 판단",
      query: "초기 질문"
    });

    const result = (response as { result: { structuredContent: { run: { id: string; status: string }; mcpSummary: { status: string; clarificationQuestions: string[]; recommendedNextTools: string[]; nextToolCall: { name: string; arguments: { projectId: string; runId: string } }; clarificationTemplate: { tool: string; queryTemplate: string; guidance: string; questions: string[]; fieldHints: Array<{ question: string; suggestedField: string }> } } } } }).result;

    expect(result.structuredContent.run.status).toBe("awaiting_clarification");
    expect(result.structuredContent.mcpSummary.status).toBe("awaiting_clarification");
    expect(result.structuredContent.mcpSummary.clarificationQuestions).toEqual([
      "무엇을 결정하려는지 알려줘."
    ]);
    expect(result.structuredContent.mcpSummary.recommendedNextTools).toEqual([
      "clarify_run",
      "get_run"
    ]);
    expect(result.structuredContent.mcpSummary.nextToolCall).toEqual({
      name: "clarify_run",
      arguments: {
        projectId: project.project.id,
        runId: result.structuredContent.run.id
      }
    });
    expect(result.structuredContent.mcpSummary.clarificationTemplate).toEqual({
      tool: "clarify_run",
      queryTemplate: "현재 제목: 시장 진입 판단\n현재 입력: 초기 질문\n현재 pastedContent:\n\n목표: \n대상: \n비교: ",
      guidance: "현재 문맥을 유지한 채 빈 칸을 채워 같은 runId로 다시 실행한다.",
      questions: ["무엇을 결정하려는지 알려줘."],
      fieldHints: [
        {
          question: "무엇을 결정하려는지 알려줘.",
          suggestedField: "goal"
        }
      ]
    });
  });

  it("returns a single artifact from fetch_web and never throws", async () => {
    const { createMcpHandler } = await import("@/lib/mcp/server");

    const handleMcpRequest = createMcpHandler({
      fetchWeb: async () => {
        throw new Error("network exploded");
      }
    });

    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: {
        name: "fetch_web",
        arguments: {
          url: "https://example.com/fail"
        }
      }
    });

    const result = (response as { result: { structuredContent: SourceArtifact } }).result;
    expect(result.structuredContent.adapter).toBe("mcp/fetch_web");
    expect(result.structuredContent.metadata.fetch_status).toBe("error");
    expect(result.structuredContent.metadata.error).toContain("network exploded");
  });

  it("builds follow-up suggestions for contradiction signals", async () => {
    await setupTempWorkspace();

    const workspace = await import("@/lib/storage/workspace");
    const project = await workspace.createProjectRecord({
      name: "Decision Engine",
      description: "AI-first"
    });
    const run = await workspace.createRunRecord(project.project.id, {
      title: "시장 진입 판단",
      naturalLanguage: "시장 진입 여부 판단"
    });

    await workspace.updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      normalizedInput: {
        title: record.run.title,
        naturalLanguage: "시장 진입 여부 판단",
        pastedContent: "",
        urls: [],
        goal: "결정",
        target: "solo 개발자",
        comparisonAxis: "기존 채널"
      },
      artifacts: [
        {
          id: "artifact-1",
          adapter: "kb-preread",
          sourceType: "kb",
          title: "시장 진입 prior",
          url: "https://example.com/internal",
          snippet: "",
          content: "내부 prior",
          sourcePriority: "analysis",
          sourceTier: "internal",
          metadata: {
            fetcher: "kb-preread",
            fetch_status: "success",
            block_reason: "unknown",
            bypass_level: "none",
            login_required: "false"
          }
        },
        {
          id: "artifact-2",
          adapter: "community-search-json",
          sourceType: "community",
          title: "시장 진입 운영 후기",
          url: "https://reddit.com/example",
          snippet: "",
          content: "커뮤니티 의견",
          sourcePriority: "community",
          sourceTier: "community",
          metadata: {
            fetcher: "community-search-json",
            fetch_status: "success",
            block_reason: "unknown",
            bypass_level: "none",
            login_required: "false"
          }
        }
      ],
      citations: [
        {
          id: "citation-1",
          artifactId: "artifact-1",
          url: "https://example.com/internal",
          title: "시장 진입 prior",
          priority: "analysis"
        },
        {
          id: "citation-2",
          artifactId: "artifact-2",
          url: "https://reddit.com/example",
          title: "시장 진입 운영 후기",
          priority: "community"
        }
      ],
      claims: [
        {
          id: "claim-1",
          artifactId: "artifact-1",
          text: "시장 진입은 지금이 적기다.",
          topicKey: "시장-진입",
          stance: "support",
          citationIds: ["citation-1"]
        },
        {
          id: "claim-2",
          artifactId: "artifact-2",
          text: "시장 진입은 아직 이르다.",
          topicKey: "시장-진입",
          stance: "oppose",
          citationIds: ["citation-2"]
        }
      ],
      contradictions: [
        {
          id: "contradiction-1",
          claimIds: ["claim-1", "claim-2"],
          status: "flagged",
          resolution: "unresolved",
          kind: "internal_vs_community",
          tierA: "internal",
          tierB: "community"
        },
        {
          id: "contradiction-2",
          claimIds: ["claim-3", "claim-4"],
          status: "flagged",
          resolution: "unresolved",
          kind: "aggregator_only",
          tierA: "aggregator",
          tierB: "aggregator"
        }
      ]
    }));

    const followupResponse = await callTool("suggest_followup_run", {
      projectId: project.project.id,
      runId: run.run.id,
      contradictionId: "contradiction-1"
    });
    const followupResult = (followupResponse as { result: { structuredContent: { contradictionId: string; kind: string; followup: { suggestedTitle: string; suggestedNaturalLanguage: string; suggestedComparisonAxis: string } } } }).result;

    expect(followupResult.structuredContent.contradictionId).toBe("contradiction-1");
    expect(followupResult.structuredContent.kind).toBe("internal_vs_community");
    expect(followupResult.structuredContent.followup).toEqual({
      suggestedTitle: "시장 진입 — 내 KB 대비 최신 커뮤니티 의견 재검증",
      suggestedNaturalLanguage:
        "목표: 내부 지식과 커뮤니티 의견이 충돌. 내 KB가 stale일 가능성.\n대상: solo 개발자\n비교: 내 KB 기준, 커뮤니티 최신 의견",
      suggestedComparisonAxis: "내 KB 기준, 커뮤니티 최신 의견"
    });

    const aggregatorOnlyResponse = await callTool("suggest_followup_run", {
      projectId: project.project.id,
      runId: run.run.id,
      contradictionId: "contradiction-2"
    });
    const aggregatorOnlyResult = (aggregatorOnlyResponse as { result: { structuredContent: { contradictionId: string; kind: string; followup: null } } }).result;

    expect(aggregatorOnlyResult.structuredContent).toEqual({
      contradictionId: "contradiction-2",
      kind: "aggregator_only",
      followup: null
    });

    const missingContradictionResponse = await callTool("suggest_followup_run", {
      projectId: project.project.id,
      runId: run.run.id,
      contradictionId: "missing-contradiction"
    });
    expect((missingContradictionResponse as { error: { message: string } }).error.message).toBe(
      "contradiction_not_found"
    );

    const missingRunResponse = await callTool("suggest_followup_run", {
      projectId: project.project.id,
      runId: "missing-run",
      contradictionId: "contradiction-1"
    });
    expect((missingRunResponse as { error: { message: string } }).error.message).toBe(
      "run_not_found"
    );
  });

  it("returns gathered artifacts for gather_for_run", async () => {
    const { createMcpHandler } = await import("@/lib/mcp/server");

    const handleMcpRequest = createMcpHandler({
      gatherForRun: async (runId) => [
        {
          id: "artifact-0",
          adapter: "scrapling",
          sourceType: "web",
          title: `run:${runId}`,
          url: "https://example.com/a",
          snippet: "",
          content: "body",
          sourcePriority: "analysis",
          metadata: {
            fetcher: "scrapling",
            fetch_status: "success",
            block_reason: "unknown",
            bypass_level: "none",
            login_required: "false"
          }
        }
      ]
    });

    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: {
        name: "gather_for_run",
        arguments: {
          runId: "run-123"
        }
      }
    });

    const result = (response as { result: { structuredContent: { runId: string; artifacts: SourceArtifact[] } } }).result;
    expect(result.structuredContent.runId).toBe("run-123");
    expect(result.structuredContent.artifacts).toHaveLength(1);
    expect(result.structuredContent.artifacts[0]?.title).toBe("run:run-123");
  });

  it("lists watch targets for a project", async () => {
    await setupTempWorkspace();
    const { project, watchTarget } = await createWatchFixture();

    const response = await callTool("list_watch_targets", {
      projectId: project.project.id
    });

    const result = (response as { result: { structuredContent: { watchTargets: Array<{ id: string }> } } }).result;
    expect(result.structuredContent.watchTargets.map((item) => item.id)).toContain(watchTarget.id);
  });

  it("gets a single watch target", async () => {
    await setupTempWorkspace();
    const { project, watchTarget } = await createWatchFixture();

    const response = await callTool("get_watch_target", {
      projectId: project.project.id,
      watchTargetId: watchTarget.id
    });

    const result = (response as { result: { structuredContent: { id: string; title: string } } }).result;
    expect(result.structuredContent.id).toBe(watchTarget.id);
    expect(result.structuredContent.title).toBe("Short-form watch");
  });

  it("triggers a watch target into a run with watchContext", async () => {
    await setupTempWorkspace();
    const { project, watchTarget } = await createWatchFixture();
    const { readRunRecord } = await import("@/lib/storage/workspace");
    const { createMcpHandler } = await import("@/lib/mcp/server");
    const { triggerWatchTarget } = await import("@/lib/orchestrator/watch-runtime");
    const handleMcpRequest = createMcpHandler({
      triggerWatch: (projectId, watchTargetId) =>
        triggerWatchTarget(projectId, watchTargetId, {
          executeRun: async (p, r) => readRunRecord(p, r)
        })
    });

    const response = await callToolWithHandler(handleMcpRequest, "trigger_watch", {
      projectId: project.project.id,
      watchTargetId: watchTarget.id
    });

    const result = (response as { result: { structuredContent: { watchContext: { watchTargetId: string } } } }).result;
    expect(result.structuredContent.watchContext.watchTargetId).toBe(watchTarget.id);
  });

  it("lists digests and supports watchTarget filtering", async () => {
    await setupTempWorkspace();
    const { workspace, project, watchTarget } = await createWatchFixture();

    const run = await workspace.createRunRecord(project.project.id, {
      title: "tick",
      urls: []
    });
    await workspace.updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      watchContext: { watchTargetId: watchTarget.id, digestId: null }
    }));
    const digest = await (await import("@/lib/orchestrator/watch-digest")).buildWatchDigest(
      project.project.id,
      watchTarget.id,
      { sourceRunIds: [run.run.id] }
    );

    const response = await callTool("list_digests", {
      projectId: project.project.id,
      watchTargetId: watchTarget.id
    });

    const result = (response as { result: { structuredContent: { digests: Array<{ id: string }> } } }).result;
    expect(result.structuredContent.digests.map((item) => item.id)).toEqual([digest.id]);
  });

  it("gets a single digest", async () => {
    await setupTempWorkspace();
    const { workspace, project, watchTarget } = await createWatchFixture();

    const run = await workspace.createRunRecord(project.project.id, {
      title: "tick",
      urls: []
    });
    await workspace.updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      watchContext: { watchTargetId: watchTarget.id, digestId: null }
    }));
    const digest = await (await import("@/lib/orchestrator/watch-digest")).buildWatchDigest(
      project.project.id,
      watchTarget.id,
      { sourceRunIds: [run.run.id] }
    );

    const response = await callTool("get_digest", {
      projectId: project.project.id,
      digestId: digest.id
    });

    const result = (response as { result: { structuredContent: { id: string; watchTargetId: string } } }).result;
    expect(result.structuredContent.id).toBe(digest.id);
    expect(result.structuredContent.watchTargetId).toBe(watchTarget.id);
  });

  it("builds a watch digest from source runs", async () => {
    await setupTempWorkspace();
    const { workspace, project, watchTarget } = await createWatchFixture();

    const run = await workspace.createRunRecord(project.project.id, {
      title: "tick",
      urls: []
    });
    await workspace.updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      watchContext: { watchTargetId: watchTarget.id, digestId: null }
    }));

    const response = await callTool("build_watch_digest", {
      projectId: project.project.id,
      watchTargetId: watchTarget.id,
      sourceRunIds: [run.run.id]
    });

    const result = (response as { result: { structuredContent: { sourceRunIds: string[]; status: string } } }).result;
    expect(result.structuredContent.sourceRunIds).toEqual([run.run.id]);
    expect(result.structuredContent.status).toBe("built");
  });

  it("lists inbox items and supports status filtering", async () => {
    await setupTempWorkspace();
    const { workspace, project, watchTarget } = await createWatchFixture();

    const run = await workspace.createRunRecord(project.project.id, {
      title: "tick",
      urls: []
    });
    await workspace.updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      watchContext: { watchTargetId: watchTarget.id, digestId: null }
    }));
    await (await import("@/lib/orchestrator/watch-digest")).buildWatchDigest(
      project.project.id,
      watchTarget.id,
      { sourceRunIds: [run.run.id] }
    );

    const response = await callTool("list_inbox", {
      projectId: project.project.id,
      status: "unread"
    });

    const result = (response as { result: { structuredContent: { inboxItems: Array<{ status: string }> } } }).result;
    expect(result.structuredContent.inboxItems).toHaveLength(1);
    expect(result.structuredContent.inboxItems[0]?.status).toBe("unread");
  });

  it("archives an inbox item", async () => {
    await setupTempWorkspace();
    const { workspace, project, watchTarget } = await createWatchFixture();

    const run = await workspace.createRunRecord(project.project.id, {
      title: "tick",
      urls: []
    });
    await workspace.updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      watchContext: { watchTargetId: watchTarget.id, digestId: null }
    }));
    await (await import("@/lib/orchestrator/watch-digest")).buildWatchDigest(
      project.project.id,
      watchTarget.id,
      { sourceRunIds: [run.run.id] }
    );
    const inboxItems = await workspace.listInboxItemRecords(project.project.id);

    const response = await callTool("archive_inbox_item", {
      projectId: project.project.id,
      itemId: inboxItems[0]?.id
    });

    const result = (response as { result: { structuredContent: { status: string } } }).result;
    expect(result.structuredContent.status).toBe("archived");
  });

  it("promotes a digest into a project run", async () => {
    await setupTempWorkspace();
    const { workspace, project, watchTarget } = await createWatchFixture();
    const { createMcpHandler } = await import("@/lib/mcp/server");
    const { promoteDigestToProject } = await import("@/lib/orchestrator/watch-inbox");

    const run = await workspace.createRunRecord(project.project.id, {
      title: "tick",
      urls: []
    });
    await workspace.updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      watchContext: { watchTargetId: watchTarget.id, digestId: null }
    }));
    const digest = await (await import("@/lib/orchestrator/watch-digest")).buildWatchDigest(
      project.project.id,
      watchTarget.id,
      { sourceRunIds: [run.run.id] }
    );
    const handleMcpRequest = createMcpHandler({
      promoteDigestToProject: (projectId, digestId) =>
        promoteDigestToProject(projectId, digestId, {
          executeRun: async (p, r) => workspace.readRunRecord(p, r)
        })
    });

    const response = await callToolWithHandler(handleMcpRequest, "promote_digest_to_project", {
      projectId: project.project.id,
      digestId: digest.id
    });

    const result = (response as { result: { structuredContent: { projectOrigin: { digestId: string } } } }).result;
    expect(result.structuredContent.projectOrigin.digestId).toBe(digest.id);
  });

  it("runs a scheduler tick through MCP", async () => {
    await setupTempWorkspace();
    const { project } = await createWatchFixture();
    const { createMcpHandler } = await import("@/lib/mcp/server");

    const handleMcpRequest = createMcpHandler({
      runSchedulerTick: async (deps) => ({
        triggered: [
          {
            projectId: deps?.projectId ?? project.project.id,
            watchTargetId: "watch-1",
            runId: "run-1"
          }
        ],
        skipped: [
          {
            projectId: deps?.projectId ?? project.project.id,
            watchTargetId: "watch-2",
            reason: "not_due"
          }
        ]
      })
    });

    const response = await callToolWithHandler(handleMcpRequest, "run_scheduler_tick", {
      projectId: project.project.id
    });

    const result = (response as {
      result: {
        structuredContent: {
          triggered: Array<{ runId: string }>;
          skipped: Array<{ reason: string }>;
        };
      };
    }).result;
    expect(result.structuredContent.triggered[0]?.runId).toBe("run-1");
    expect(result.structuredContent.skipped[0]?.reason).toBe("not_due");
  });

  it("returns an error for a missing watch target", async () => {
    await setupTempWorkspace();
    const { project } = await createWatchFixture();

    const response = await callTool("get_watch_target", {
      projectId: project.project.id,
      watchTargetId: "missing-watch-target"
    });

    expect(response).toMatchObject({
      error: {
        code: -32000
      }
    });
  });

  it("returns an error for a missing digest", async () => {
    await setupTempWorkspace();
    const { project } = await createWatchFixture();

    const response = await callTool("get_digest", {
      projectId: project.project.id,
      digestId: "missing-digest"
    });

    expect(response).toMatchObject({
      error: {
        code: -32000
      }
    });
  });

  it("returns an error for an invalid inbox status", async () => {
    await setupTempWorkspace();
    const { project } = await createWatchFixture();

    const response = await callTool("list_inbox", {
      projectId: project.project.id,
      status: "bad-status"
    });

    expect(response).toMatchObject({
      error: {
        code: -32000,
        message: "status must be unread, read, archived, or promoted"
      }
    });
  });

  it("runs the watch MCP flow end-to-end", async () => {
    await setupTempWorkspace();
    const { workspace, project, watchTarget } = await createWatchFixture();
    const { createMcpHandler } = await import("@/lib/mcp/server");
    const { triggerWatchTarget } = await import("@/lib/orchestrator/watch-runtime");
    const { promoteDigestToProject } = await import("@/lib/orchestrator/watch-inbox");
    const handleMcpRequest = createMcpHandler({
      triggerWatch: (projectId, watchTargetId) =>
        triggerWatchTarget(projectId, watchTargetId, {
          executeRun: async (p, r) => workspace.readRunRecord(p, r)
        }),
      promoteDigestToProject: (projectId, digestId) =>
        promoteDigestToProject(projectId, digestId, {
          executeRun: async (p, r) => workspace.readRunRecord(p, r)
        })
    });

    const triggerResponse = await callToolWithHandler(handleMcpRequest, "trigger_watch", {
      projectId: project.project.id,
      watchTargetId: watchTarget.id
    });
    const triggered = (triggerResponse as { result: { structuredContent: { run: { id: string } } } }).result.structuredContent;

    const emptyDigestList = await callToolWithHandler(handleMcpRequest, "list_digests", {
      projectId: project.project.id,
      watchTargetId: watchTarget.id
    });
    expect(
      (emptyDigestList as { result: { structuredContent: { digests: unknown[] } } }).result.structuredContent.digests
    ).toEqual([]);

    const buildResponse = await callToolWithHandler(handleMcpRequest, "build_watch_digest", {
      projectId: project.project.id,
      watchTargetId: watchTarget.id,
      sourceRunIds: [triggered.run.id]
    });
    const builtDigest = (buildResponse as { result: { structuredContent: { id: string } } }).result.structuredContent;

    const digestList = await callToolWithHandler(handleMcpRequest, "list_digests", {
      projectId: project.project.id,
      watchTargetId: watchTarget.id
    });
    expect(
      (digestList as { result: { structuredContent: { digests: Array<{ id: string }> } } }).result
        .structuredContent.digests[0]?.id
    ).toBe(builtDigest.id);

    const inboxList = await callToolWithHandler(handleMcpRequest, "list_inbox", {
      projectId: project.project.id
    });
    const inboxItems = (inboxList as { result: { structuredContent: { inboxItems: Array<{ id: string; refId: string }> } } }).result.structuredContent.inboxItems;
    expect(inboxItems[0]?.refId).toBe(builtDigest.id);

    const promoteResponse = await callToolWithHandler(handleMcpRequest, "promote_digest_to_project", {
      projectId: project.project.id,
      digestId: builtDigest.id
    });
    const promoted = (promoteResponse as { result: { structuredContent: { run: { id: string } } } }).result.structuredContent;
    const promotedRun = await workspace.readRunRecord(project.project.id, promoted.run.id);

    expect(promotedRun.projectOrigin).toEqual({
      source: "watch_digest",
      watchTargetId: watchTarget.id,
      digestId: builtDigest.id,
      inboxItemId: expect.any(String),
      sourceRunIds: [triggered.run.id]
    });
  });

  it("returns empty results when no watches are due", async () => {
    await setupTempWorkspace();
    const { createMcpHandler } = await import("@/lib/mcp/server");

    const handleMcpRequest = createMcpHandler({
      runSchedulerTick: async () => ({
        triggered: [],
        skipped: []
      })
    });

    const response = await callToolWithHandler(handleMcpRequest, "run_scheduler_tick", {});
    const result = (response as {
      result: {
        structuredContent: {
          triggered: unknown[];
          skipped: unknown[];
        };
      };
    }).result;

    expect(result.structuredContent.triggered).toEqual([]);
    expect(result.structuredContent.skipped).toEqual([]);
  });

  it("calls query_events and returns grouped counts", async () => {
    await setupTempWorkspace();

    const { createProjectRecord, createRunRecord } = await import("@/lib/storage/workspace");
    const { appendRunEvent } = await import("@/lib/bridge/cli-file");
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

    const response = await callTool("query_events", {
      sql: "SELECT type, COUNT(*)::BIGINT AS count FROM events GROUP BY type"
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
    await setupTempWorkspace();

    const { createProjectRecord, createRunRecord, updateRunRecord } = await import("@/lib/storage/workspace");
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

    const response = await callTool("export_linkit_ingest", {
      projectId: project.project.id,
      runId: run.run.id
    });

    const result = (response as { result: { structuredContent: { normalizedCount: number; readyCount: number } } }).result;
    expect(result.structuredContent.normalizedCount).toBe(1);
    expect(result.structuredContent.readyCount).toBe(1);
  });

  it("publishes a linkit batch through MCP", async () => {
    await setupTempWorkspace();

    const { createProjectRecord, createRunRecord, updateRunRecord } = await import("@/lib/storage/workspace");
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

    const response = await callTool("publish_linkit_batch", {
      projectId: project.project.id,
      runId: run.run.id,
      apiBaseUrl: "https://linkit.test",
      siteUrl: "https://linkit.site",
      actorEmail: "ops@example.com"
    });

    const result = (response as { result: { structuredContent: { published: number; notifierPath: string } } }).result;
    expect(result.structuredContent.published).toBe(1);
    expect(result.structuredContent.notifierPath).toContain("discord-notifier.json");
  });

  it("sends a discord notifier through MCP", async () => {
    await setupTempWorkspace();

    const bridgeDir = path.join(tempRoot!, "project-1", "runs", "run-1", "bridge");
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

    const response = await callTool("send_discord_notifier", {
      projectId: "project-1",
      runId: "run-1",
      webhookUrl: "https://discord.com/api/webhooks/test"
    });

    const result = (response as { result: { structuredContent: { webhookMessageId: string | null; resultPath: string } } }).result;
    expect(result.structuredContent.webhookMessageId).toBe("discord-msg-1");
    expect(result.structuredContent.resultPath).toContain("discord-send-result.json");
  });
});
