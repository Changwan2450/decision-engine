import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceArtifact } from "@/lib/adapters/types";

let tempRoot: string | null = null;

describe("linkit publish bridge", () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    delete process.env.WORKSPACE_ROOT;
  });

  it("publishes ready items and writes discord notifier payload", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "decision-engine-linkit-publish-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const { createProjectRecord, createRunRecord, updateRunRecord } = await import(
      "@/lib/storage/workspace"
    );
    const { publishLinkitBatch } = await import("@/lib/bridge/linkit-publish");

    const project = await createProjectRecord({
      name: "Linkit Publish",
      description: "publish test"
    });
    const run = await createRunRecord(project.project.id, {
      title: "AI coding signals",
      naturalLanguage: "최근 AI coding signals"
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
          author_handle: "@midudev",
          category: "claude-code"
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

    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://linkit.test/api/prototypes/ingest");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["X-Access-User-Email"]).toBe("ops@example.com");
      const body = JSON.parse(String(init?.body)) as { items: Array<{ title: string }> };
      expect(body.items).toHaveLength(2);

      return new Response(
        JSON.stringify({
          published: 2,
          items: [
            { id: "link_1", title: "OpenAI Codex Plugin 관련 저장소", category: "codex-cli" },
            { id: "link_2", title: "Claude Code 토큰 사용량 문제를 추적하고 우회한 사례", category: "claude-code" }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    });

    const result = await publishLinkitBatch(project.project.id, run.run.id, {
      apiBaseUrl: "https://linkit.test",
      siteUrl: "https://linkit.site",
      actorEmail: "ops@example.com",
      fetchImpl
    });

    const notifier = JSON.parse(await readFile(result.notifierPath, "utf8")) as {
      counts: { published: number; today: number; github: number };
      highlights: string[];
      top_items: Array<{ url: string }>;
    };

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.published).toBe(2);
    expect(notifier.counts).toEqual({
      published: 2,
      today: 2,
      github: 0
    });
    expect(notifier.highlights[0]).toContain("오늘의 추천 2개 갱신");
    expect(notifier.top_items[0]?.url).toContain("https://linkit.site/post/");
  });
});
