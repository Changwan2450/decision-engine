import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SourceArtifact } from "@/lib/adapters/types";

let tempRoot: string | null = null;

describe("cli file bridge", () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    delete process.env.WORKSPACE_ROOT;
  });

  it("writes run-state.json with current run snapshot", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "decision-engine-bridge-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const { createProjectRecord, createRunRecord, updateRunRecord } = await import(
      "@/lib/storage/workspace"
    );
    const { appendRunEvent, writeRunStateSnapshot } = await import("@/lib/bridge/cli-file");

    const project = await createProjectRecord({
      name: "Decision Engine",
      description: "AI-first"
    });
    const run = await createRunRecord(project.project.id, {
      title: "시장 진입 판단",
      naturalLanguage: "시장 진입 여부 판단"
    });

    await updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      decision: {
        value: "go",
        why: "고우선 근거가 충분하다.",
        confidence: "medium",
        blockingUnknowns: ["retention validation"],
        nextActions: ["pilot launch"]
      },
      advisory: {
        externalSummary: "외부 요약",
        suggestedNextActions: ["추가 인터뷰"],
        notes: ["raw output normalized"],
        provider: "codex",
        mode: "cli_execute",
        ingestedAt: "2026-04-10T00:00:00.000Z",
        executedAt: "2026-04-10T00:00:00.000Z",
        success: true,
        schemaVersion: "cli-bridge-v1"
      },
      run: {
        ...record.run,
        status: "decided",
        updatedAt: "2026-04-10T00:00:00.000Z"
      },
      artifacts: []
    }));

    const filePath = await writeRunStateSnapshot(project.project.id, run.run.id);
    const snapshot = JSON.parse(await readFile(filePath, "utf8")) as {
      projectId: string;
      runId: string;
      status: string;
      decision: { value: string; confidence: string } | null;
      artifactCount: number;
      advisoryStatus: string;
    };

    expect(snapshot.projectId).toBe(project.project.id);
    expect(snapshot.runId).toBe(run.run.id);
    expect(snapshot.status).toBe("decided");
    expect(snapshot.decision).toEqual({
      value: "go",
      confidence: "medium"
    });
    expect(snapshot.artifactCount).toBe(0);
    expect(snapshot.advisoryStatus).toBe("available");

    const eventPath = await appendRunEvent(project.project.id, run.run.id, {
      type: "run_state_written",
      detail: {
        status: "decided"
      },
      at: "2026-04-10T00:00:01.000Z"
    });
    const events = (await readFile(eventPath, "utf8")).trim().split("\n");

    expect(events).toHaveLength(2);
    expect(JSON.parse(events[0]).type).toBe("run_state_written");
    expect(JSON.parse(events[1])).toEqual({
      type: "run_state_written",
      detail: {
        status: "decided"
      },
      at: "2026-04-10T00:00:01.000Z"
    });
  });

  it("exports digest, normalized items, and linkit-ready items", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "decision-engine-linkit-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const { createProjectRecord, createRunRecord, updateRunRecord } = await import(
      "@/lib/storage/workspace"
    );
    const { exportLinkitIngestBundle } = await import("@/lib/bridge/linkit-export");

    const project = await createProjectRecord({
      name: "Linkit Feed",
      description: "Digest export"
    });
    const run = await createRunRecord(project.project.id, {
      title: "AI coding signals",
      naturalLanguage: "최신 AI coding 신호 정리"
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
      },
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
          author_handle: "@midudev"
        }
      },
      {
        id: "artifact-missing-url",
        adapter: "agent-reach",
        sourceType: "web",
        title: "Claude Code Agents 관련 저장소가 참고 후보로 수집됐다",
        url: "https://placeholder.invalid/claude-code-agents",
        snippet: "Claude Code Agents 관련 참고 후보",
        content: "",
        sourcePriority: "analysis",
        publishedAt: "2026-03-31T21:56:00.000Z",
        metadata: {
          needs_enrichment: "true",
          url_missing: "true"
        }
      }
    ];

    await updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      artifacts,
      run: {
        ...record.run,
        updatedAt: "2026-04-13T00:00:00.000Z"
      }
    }));

    const result = await exportLinkitIngestBundle(project.project.id, run.run.id);
    const digest = await readFile(result.digestPath, "utf8");
    const normalized = JSON.parse(await readFile(result.normalizedPath, "utf8")) as {
      items: Array<{
        title: string;
        source_type: string;
        dedupe_key: string;
        needs_enrichment: boolean;
      }>;
    };
    const ready = JSON.parse(await readFile(result.readyPath, "utf8")) as {
      items: Array<{ title: string }>;
    };

    expect(result.normalizedCount).toBe(3);
    expect(result.readyCount).toBe(2);
    expect(digest).toContain("Agent Reach Digest");
    expect(digest).toContain("프로젝트/리포");
    expect(digest).toContain("인사이트/X");
    expect(normalized.items).toHaveLength(3);
    expect(normalized.items[0]?.dedupe_key).toContain(":");
    expect(normalized.items.find((item) => item.title === "Claude Code Agents 관련 저장소")?.needs_enrichment).toBe(true);
    expect(ready.items).toHaveLength(2);
    expect(ready.items.some((item) => item.title === "OpenAI Codex Plugin 관련 저장소")).toBe(true);
    expect(ready.items.some((item) => item.title === "Claude Code 토큰 사용량 문제를 추적하고 우회한 사례")).toBe(true);
  });

  it("dedupes ready items and keeps the strongest representative", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "decision-engine-linkit-quality-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const { createProjectRecord, createRunRecord, updateRunRecord } = await import(
      "@/lib/storage/workspace"
    );
    const { exportLinkitIngestBundle } = await import("@/lib/bridge/linkit-export");

    const project = await createProjectRecord({
      name: "Linkit Quality",
      description: "Deduped export"
    });
    const run = await createRunRecord(project.project.id, {
      title: "Claude Code duplicates",
      naturalLanguage: "중복 이슈 대표 선택"
    });

    const artifacts: SourceArtifact[] = [
      {
        id: "artifact-reddit-low",
        adapter: "agent-reach",
        sourceType: "community",
        title: "  - Claude Code 소스 구조와 내부 구현을 분석한 실사용 글이 주목받고 있다  ",
        url: "https://reddit.com/r/ClaudeAI/comments/1",
        snippet: "저점 대표",
        content: "",
        sourcePriority: "community",
        publishedAt: "2026-04-01T00:00:00.000Z",
        metadata: {
          source_type: "reddit",
          canonical_url: "https://reddit.com/r/ClaudeAI/comments/1",
          score: "5513",
          comment_count: "678",
          community_name: "r/ClaudeAI"
        }
      },
      {
        id: "artifact-reddit-high",
        adapter: "agent-reach",
        sourceType: "community",
        title: "Claude Code 소스 구조와 내부 구현을 분석한 실사용 글이 주목받고 있다",
        url: "https://reddit.com/r/ClaudeAI/comments/1",
        snippet: "고점 대표",
        content: "",
        sourcePriority: "community",
        publishedAt: "2026-04-01T04:07:00.000Z",
        metadata: {
          source_type: "reddit",
          canonical_url: "https://reddit.com/r/ClaudeAI/comments/1",
          score: "5713",
          comment_count: "700",
          community_name: "r/ClaudeAI"
        }
      },
      {
        id: "artifact-needs-enrichment",
        adapter: "agent-reach",
        sourceType: "web",
        title: "Claude Code Agents 관련 저장소가 참고 후보로 수집됐다",
        url: "https://placeholder.invalid/claude-code-agents",
        snippet: "보강 필요",
        content: "",
        sourcePriority: "analysis",
        publishedAt: "2026-03-31T21:56:00.000Z",
        metadata: {
          needs_enrichment: "true",
          url_missing: "true"
        }
      }
    ];

    await updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      artifacts
    }));

    const result = await exportLinkitIngestBundle(project.project.id, run.run.id);
    const normalized = JSON.parse(await readFile(result.normalizedPath, "utf8")) as {
      items: Array<{ title: string; score: number; needs_enrichment: boolean }>;
    };
    const ready = JSON.parse(await readFile(result.readyPath, "utf8")) as {
      items: Array<{ title: string; score: number; canonical_url: string | null }>;
    };

    expect(normalized.items.find((item) => item.score === 5513)?.title).toBe(
      "Claude Code 소스 구조와 내부 구현을 분석한 실사용 글"
    );
    expect(normalized.items.find((item) => item.score === 5713)?.title).toBe(
      "Claude Code 소스 구조와 내부 구현을 분석한 실사용 글"
    );
    expect(ready.items).toHaveLength(1);
    expect(ready.items[0]).toMatchObject({
      title: "Claude Code 소스 구조와 내부 구현을 분석한 실사용 글",
      score: 5713,
      canonical_url: "https://reddit.com/r/ClaudeAI/comments/1"
    });
  });
});
