import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildArtifact,
  buildFailureArtifact
} from "@/lib/adapters/contract";
import type {
  ResearchAdapter,
  ResearchPlan,
  SourceArtifact
} from "@/lib/adapters/types";
import { setQmdClientForTests } from "@/lib/orchestrator/kb-context";

let tempRoot: string | null = null;
let tempVault: string | null = null;

function makePlan(urls: string[]): ResearchPlan {
  return {
    projectId: "project-1",
    runId: "run-1",
    title: "run title",
    mode: "standard",
    normalizedInput: {
      title: "run title",
      naturalLanguage: "",
      pastedContent: "",
      urls,
      goal: "",
      target: "",
      comparisonAxis: ""
    },
    sourceTargets: ["web", "community", "video", "github"],
    kbContext: null
  };
}

function makeAdapter(
  name: string,
  exec: (plan: ResearchPlan) => Promise<SourceArtifact[]>
): ResearchAdapter {
  return {
    name,
    supports: () => true,
    execute: exec
  };
}

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
    expect(storedRun.expansion).not.toBeNull();
    expect(storedRun.expansion?.expanded.length).toBeGreaterThan(0);
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

  it("persists expansion once at collecting and keeps it stable across later stages", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "research-expansion-"));
    tempVault = await mkdtemp(path.join(os.tmpdir(), "research-vault-"));
    process.env.WORKSPACE_ROOT = tempRoot;
    process.env.OBSIDIAN_VAULT_PATH = tempVault;
    setQmdClientForTests({
      async operatorNotes() {
        return [];
      },
      async queryNotes() {
        return [];
      }
    });

    const { createProjectRecord, createRunRecord, readRunRecord } = await import(
      "@/lib/storage/workspace"
    );
    const { executeResearchRun } = await import("@/lib/orchestrator/run-research");

    const project = await createProjectRecord({
      name: "Expansion",
      description: "expansion persistence"
    });
    const run = await createRunRecord(project.project.id, {
      title: "OpenAI pricing",
      naturalLanguage: "목표: 가격 파악\n대상: 개발자\n비교: Anthropic, Google",
      urls: ["https://example.com/original"]
    });

    const observedExpansions: string[] = [];

    await executeResearchRun(project.project.id, run.run.id, {
      now: "2026-04-18T00:00:00.000Z",
      gather: async () => {
        const { readRunRecord: readCurrentRun } = await import("@/lib/storage/workspace");
        const current = await readCurrentRun(project.project.id, run.run.id);
        observedExpansions.push(JSON.stringify(current.expansion));
        return [];
      }
    });

    const storedRun = await readRunRecord(project.project.id, run.run.id);

    expect(storedRun.expansion).not.toBeNull();
    expect(storedRun.expansion?.expanded.some((entry) => entry.axis === "official")).toBe(true);
    expect(observedExpansions).toHaveLength(1);
    expect(JSON.parse(observedExpansions[0] ?? "null")).toEqual(storedRun.expansion);
  });
});

describe("runResearch", () => {
  it("routes URL through primary first and stops on success", async () => {
    const { runResearch } = await import("@/lib/orchestrator/run-research");
    const calls: string[] = [];

    const artifacts = await runResearch(makePlan(["https://example.com/post"]), {
      router: () => ({
        primary: "agent-reach",
        fallbacks: ["scrapling"],
        rule: "web/generic"
      }),
      registry: {
        "agent-reach": makeAdapter("agent-reach", async (plan) => {
          calls.push(`agent-reach:${plan.normalizedInput.urls[0]}`);
          return [
            buildArtifact({
              id: "a-0",
              adapter: "agent-reach",
              fetcher: "agent-reach",
              sourceType: "web",
              url: plan.normalizedInput.urls[0] ?? "",
              title: "ok",
              content: "body",
              outcome: { status: "success" }
            })
          ];
        }),
        scrapling: makeAdapter("scrapling", async () => {
          calls.push("scrapling");
          return [];
        })
      }
    });

    expect(calls).toEqual(["agent-reach:https://example.com/post"]);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.adapter).toBe("agent-reach");
    expect(artifacts[0]?.metadata.fetch_status).toBe("success");
  });

  it("includes primary failure artifact before fallback success", async () => {
    const { runResearch } = await import("@/lib/orchestrator/run-research");

    const artifacts = await runResearch(makePlan(["https://reddit.com/r/x"]), {
      router: () => ({
        primary: "agent-reach",
        fallbacks: ["scrapling"],
        rule: "community/reddit"
      }),
      registry: {
        "agent-reach": makeAdapter("agent-reach", async (plan) => [
          buildFailureArtifact({
            id: "agent-reach-0",
            adapter: "agent-reach",
            fetcher: "agent-reach",
            url: plan.normalizedInput.urls[0] ?? "",
            sourceType: "community",
            outcome: { status: "error" },
            errorMessage: "primary failed"
          })
        ]),
        scrapling: makeAdapter("scrapling", async (plan) => [
          buildArtifact({
            id: "scrapling-0",
            adapter: "scrapling",
            fetcher: "scrapling",
            sourceType: "community",
            url: plan.normalizedInput.urls[0] ?? "",
            title: "fallback",
            content: "ok",
            outcome: { status: "success" }
          })
        ])
      }
    });

    expect(artifacts.map((artifact) => artifact.adapter)).toEqual([
      "agent-reach",
      "scrapling"
    ]);
    expect(artifacts.map((artifact) => artifact.metadata.fetch_status)).toEqual([
      "error",
      "success"
    ]);
  });

  it("records timeout and skips fallback when budget is exhausted", async () => {
    const { runResearch } = await import("@/lib/orchestrator/run-research");
    let nowMs = 0;

    const artifacts = await runResearch(makePlan(["https://example.com/slow"]), {
      router: () => ({
        primary: "agent-reach",
        fallbacks: ["scrapling"],
        rule: "web/generic"
      }),
      budgets: {
        totalMs: 100,
        perAdapterMs: 60,
        perUrlMs: 100,
        fallbackBudgetRatio: 0.4
      },
      nowMs: () => nowMs,
      registry: {
        "agent-reach": makeAdapter("agent-reach", async (plan) => {
          nowMs = 120;
          return [
            buildFailureArtifact({
              id: "agent-reach-0",
              adapter: "agent-reach",
              fetcher: "agent-reach",
              url: plan.normalizedInput.urls[0] ?? "",
              sourceType: "web",
              outcome: { status: "error" },
              errorMessage: "too slow"
            })
          ];
        }),
        scrapling: makeAdapter("scrapling", async () => {
          throw new Error("should not run");
        })
      }
    });

    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]?.metadata.fetch_status).toBe("timeout");
    expect(artifacts[0]?.metadata.error).toContain("budget");
    expect(artifacts[1]?.metadata.fetch_status).toBe("error");
    expect(artifacts[1]?.metadata.error).toContain("fallback skipped");
  });
});
