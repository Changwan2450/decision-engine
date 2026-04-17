import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setQmdClientForTests } from "@/lib/orchestrator/kb-context";

let tempRoot: string | null = null;
let tempVault: string | null = null;

describe("executeResearchRun", () => {
  afterEach(async () => {
    setQmdClientForTests(null);
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

  it("persists the full pipeline and updates project insights", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "research-pipeline-"));
    tempVault = await mkdtemp(path.join(os.tmpdir(), "research-vault-"));
    process.env.WORKSPACE_ROOT = tempRoot;
    process.env.OBSIDIAN_VAULT_PATH = tempVault;
    await mkdir(path.join(tempVault, "wiki", "concepts"), { recursive: true });
    await writeFile(
      path.join(tempVault, "wiki", "concepts", "short-form-entry-decision-patterns.md"),
      [
        "# Short-Form Entry Decision Patterns",
        "",
        "## Summary",
        "",
        "숏폼 진입 판단은 경쟁 압박과 차별화를 같이 봐야 한다.",
        "",
        "## Reusable Claims",
        "",
        "- 경쟁 압박과 차별화를 같이 봐야 한다.",
        "- 반복 retention 패턴을 확인해야 한다."
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(tempVault, "wiki", "concepts", "user-working-profile.md"),
      [
        "# User Working Profile",
        "",
        "## Summary",
        "",
        "한국어, 짧게, 증거 우선, 범위 고정으로 협업해야 한다.",
        "",
        "## Reusable Claims",
        "",
        "- Language: answer in Korean unless the user directs otherwise.",
        "- Verification: do not claim completion without executed evidence."
      ].join("\n"),
      "utf8"
    );
    setQmdClientForTests({
      async operatorNotes() {
        return [
          {
            title: "User Working Profile",
            path: "wiki/concepts/user-working-profile.md",
            summary: "한국어, 짧게, 증거 우선, 범위 고정으로 협업해야 한다.",
            reusableClaims: [
              "Language: answer in Korean unless the user directs otherwise.",
              "Verification: do not claim completion without executed evidence."
            ]
          }
        ];
      },
      async queryNotes() {
        return [
          {
            title: "Short-Form Entry Decision Patterns",
            path: "wiki/concepts/short-form-entry-decision-patterns.md",
            summary: "숏폼 진입 판단은 경쟁 압박과 차별화를 같이 봐야 한다.",
            reusableClaims: [
              "경쟁 압박과 차별화를 같이 봐야 한다.",
              "반복 retention 패턴을 확인해야 한다."
            ]
          }
        ];
      }
    });

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

    let observedPlanQueryExpansion: string[] = [];

    await executeResearchRun(project.project.id, run.run.id, {
      now: "2026-04-09T12:00:00.000Z",
      gather: async (plan) => {
        observedPlanQueryExpansion = plan.kbContext?.queryExpansion ?? [];
        return [
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
        ];
      }
    });

    const storedRun = await readRunRecord(project.project.id, run.run.id);
    const storedProject = await readProjectRecord(project.project.id);

    expect(storedRun.run.status).toBe("decided");
    expect(storedRun.normalizedInput).toMatchObject({
      goal: "숏츠 시장 진입 여부 판단",
      target: "20대 크리에이터",
      comparisonAxis: "쇼츠 vs 릴스"
    });
    expect(observedPlanQueryExpansion).toContain("Short-Form Entry Decision Patterns");
    expect(observedPlanQueryExpansion).not.toContain("User Working Profile");
    expect(storedRun.kbContext?.operatorNotes[0]?.title).toBe("User Working Profile");
    expect(storedRun.kbContext?.wikiNotes[0]?.title).toBe("Short-Form Entry Decision Patterns");
    expect(storedRun.artifacts).toHaveLength(2);
    expect(storedRun.artifacts[0]?.adapter).toBe("kb-preread");
    expect(storedRun.claims.some((claim) => claim.artifactId.startsWith("kb-preread-"))).toBe(true);
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
