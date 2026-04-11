import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let tempRoot: string | null = null;
let tempVault: string | null = null;

describe("run research obsidian integration", () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    if (tempVault) {
      await rm(tempVault, { recursive: true, force: true });
      tempVault = null;
    }
    delete process.env.WORKSPACE_ROOT;
    delete process.env.OBSIDIAN_VAULT_PATH;
  });

  it("writes run and insights markdown after a completed run", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "research-obsidian-"));
    tempVault = await mkdtemp(path.join(os.tmpdir(), "vault-obsidian-"));
    process.env.WORKSPACE_ROOT = tempRoot;
    process.env.OBSIDIAN_VAULT_PATH = tempVault;

    const { createProjectRecord, createRunRecord } = await import("@/lib/storage/workspace");
    const { executeResearchRun } = await import("@/lib/orchestrator/run-research");

    const project = await createProjectRecord({
      name: "Decision Engine",
      description: "시장조사"
    });
    const run = await createRunRecord(project.project.id, {
      title: "숏츠 시장 진입",
      naturalLanguage:
        "목표: 숏츠 시장 진입 여부 판단\n대상: 20대 크리에이터\n비교: 쇼츠 vs 릴스",
      pastedContent: "경쟁사 패턴과 반복 문제를 봐야 함",
      urls: ["https://example.com/source"]
    });

    await executeResearchRun(project.project.id, run.run.id, {
      now: "2026-04-09T12:00:00.000Z",
      gather: async () => [
        {
          id: "artifact-0",
          adapter: "agent-reach",
          sourceType: "web",
          title: "Official market note",
          url: "https://example.com/source",
          snippet: "시장 성장",
          content: "",
          sourcePriority: "official",
          publishedAt: "2026-04-09T00:00:00.000Z",
          metadata: {
            claims_json: JSON.stringify([
              {
                text: "Short-form demand is growing.",
                topicKey: "short-form-demand",
                stance: "support"
              }
            ]),
            repeated_problem: "차별화가 어렵다",
            repeated_pattern: "짧은 반복 루프로 retention을 높인다",
            competitor_signal: "릴스가 편집 자동화를 밀고 있다"
          }
        }
      ]
    });

    const runMarkdown = await readFile(
      path.join(
        tempVault,
        "DecisionEngine",
        "projects",
        "Decision Engine",
        "runs",
        `${run.run.id}.md`
      ),
      "utf8"
    );
    const insightsMarkdown = await readFile(
      path.join(
        tempVault,
        "DecisionEngine",
        "projects",
        "Decision Engine",
        "insights.md"
      ),
      "utf8"
    );

    expect(runMarkdown).toContain("- decision: go");
    expect(insightsMarkdown).toContain("## Repeated Problems");
    expect(insightsMarkdown).toContain("차별화가 어렵다");
  });
});
