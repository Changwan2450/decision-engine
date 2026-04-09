import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let tempRoot: string | null = null;

describe("executeResearchRun", () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("persists the full pipeline and updates project insights", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "research-pipeline-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const { createProjectRecord, createRunRecord, readRunRecord, readProjectRecord } = await import(
      "@/lib/storage/workspace"
    );
    const { executeResearchRun } = await import("@/lib/orchestrator/run-research");

    const project = await createProjectRecord({
      name: "Shorts",
      description: "숏츠 시장조사"
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
          snippet: "시장 성장과 경쟁사 움직임 요약",
          content: "",
          sourcePriority: "official",
          publishedAt: "2026-04-09T00:00:00.000Z",
          metadata: {
            claims_json: JSON.stringify([
              {
                text: "Short-form demand is growing.",
                topicKey: "short-form-demand",
                stance: "support"
              },
              {
                text: "Competitor loop is tightening.",
                topicKey: "competitor-loop",
                stance: "support"
              }
            ]),
            repeated_problem: "크리에이터가 포맷 차별화를 못 한다",
            repeated_pattern: "짧은 반복 루프로 retention을 높인다",
            competitor_signal: "릴스가 편집 자동화를 밀고 있다"
          }
        }
      ]
    });

    const storedRun = await readRunRecord(project.project.id, run.run.id);
    const storedProject = await readProjectRecord(project.project.id);

    expect(storedRun.run.status).toBe("decided");
    expect(storedRun.normalizedInput).toMatchObject({
      goal: "숏츠 시장 진입 여부 판단",
      target: "20대 크리에이터",
      comparisonAxis: "쇼츠 vs 릴스"
    });
    expect(storedRun.artifacts).toHaveLength(1);
    expect(storedRun.claims).toHaveLength(2);
    expect(storedRun.decision?.value).toBe("go");
    expect(storedRun.prdSeed?.targetUser).toBe("20대 크리에이터");
    expect(storedProject.insights.repeatedProblems).toContain(
      "크리에이터가 포맷 차별화를 못 한다"
    );
    expect(storedProject.insights.repeatedPatterns).toContain(
      "짧은 반복 루프로 retention을 높인다"
    );
    expect(storedProject.insights.competitorSignals).toContain(
      "릴스가 편집 자동화를 밀고 있다"
    );
  });
});
