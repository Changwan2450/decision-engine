import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildArtifact } from "@/lib/adapters/contract";
import type { ResearchAdapter, ResearchPlan, SourceArtifact } from "@/lib/adapters/types";
import { setQmdClientForTests, setQmdRunnerForTests } from "@/lib/orchestrator/kb-context";

let tempRoot: string | null = null;
let tempVault: string | null = null;

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

async function setupRun() {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "research-source-repair-"));
  tempVault = await mkdtemp(path.join(os.tmpdir(), "research-source-repair-vault-"));
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

  const { createProjectRecord, createRunRecord } = await import("@/lib/storage/workspace");
  const project = await createProjectRecord({
    name: "Source coverage repair",
    description: "bounded repair"
  });
  const run = await createRunRecord(project.project.id, {
    title: "False convergence safeguards",
    naturalLanguage:
      "목표: source coverage repair 검증\n대상: research agents\n비교: evidence layer vs summary",
    urls: []
  });

  return { project, run };
}

describe("source coverage repair in executeResearchRun", () => {
  afterEach(async () => {
    setQmdClientForTests(null);
    setQmdRunnerForTests(null);
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

  it("runs one bounded repair pass, preserves originals, and marks repair artifacts", async () => {
    const { project, run } = await setupRun();
    const { executeResearchRun } = await import("@/lib/orchestrator/run-research");
    const { readRunRecord } = await import("@/lib/storage/workspace");
    const repairUrls: string[] = [];

    await executeResearchRun(project.project.id, run.run.id, {
      now: "2026-04-25T00:00:00.000Z",
      gather: async () => [
        buildArtifact({
          id: "community-0",
          adapter: "community-search-json",
          fetcher: "community-search-json",
          sourceType: "community",
          url: "https://reddit.com/r/research/comments/source",
          title: "Community-only source",
          snippet: "community discussion",
          content: "community discussion",
          sourcePriority: "community",
          outcome: { status: "success" },
          extra: {
            claims_json: JSON.stringify([
              {
                text: "Community users describe source over reliance as a problem.",
                topicKey: "source-over-reliance",
                stance: "support"
              }
            ])
          }
        })
      ],
      research: {
        router: () => ({
          primary: "scrapling",
          fallbacks: [],
          rule: "web/public-mirror"
        }),
        registry: {
          scrapling: makeAdapter("scrapling", async (plan) => {
            const url = plan.normalizedInput.urls[0] ?? "";
            repairUrls.push(url);
            return [
              buildArtifact({
                id: `repair-${repairUrls.length}`,
                adapter: "scrapling",
                fetcher: "scrapling",
                sourceType: "web",
                url,
                title: "Official repair source",
                snippet: "official source coverage",
                content: "official source coverage",
                sourcePriority: "official",
                outcome: { status: "success" },
                extra: {
                  claims_json: JSON.stringify([
                    {
                      text: "Official guidance requires grounded evidence checks.",
                      topicKey: "source-over-reliance",
                      stance: "support"
                    }
                  ])
                }
              })
            ];
          })
        }
      }
    });

    const storedRun = await readRunRecord(project.project.id, run.run.id);
    const repairArtifacts = storedRun.artifacts.filter(
      (artifact) => artifact.metadata.repair_pass === "source_coverage_v0"
    );

    expect(storedRun.run.status).toBe("decided");
    expect(repairUrls).toHaveLength(3);
    expect(repairUrls.every((url) => url.startsWith("https://s.jina.ai/?q="))).toBe(true);
    expect(storedRun.artifacts.some((artifact) => artifact.id === "community-0")).toBe(true);
    expect(repairArtifacts).toHaveLength(3);
    expect(repairArtifacts[0]?.metadata).toMatchObject({
      repair_pass: "source_coverage_v0",
      repair_reason: "no_official_or_primary_evidence",
      repair_attempt_index: "0"
    });
    expect(repairArtifacts[0]?.metadata.repair_query.length).toBeLessThanOrEqual(240);
    expect(storedRun.evidenceSummary?.hasOfficialOrPrimaryEvidence).toBe(true);
    expect(storedRun.evidenceSummary?.sourcePriorityCounts?.official).toBe(3);
  });

  it("does not run repair when official evidence is already present", async () => {
    const { project, run } = await setupRun();
    const { executeResearchRun } = await import("@/lib/orchestrator/run-research");
    const { readRunRecord } = await import("@/lib/storage/workspace");

    await executeResearchRun(project.project.id, run.run.id, {
      now: "2026-04-25T00:00:00.000Z",
      gather: async () => [
        buildArtifact({
          id: "official-0",
          adapter: "scrapling",
          fetcher: "scrapling",
          sourceType: "web",
          url: "https://example.com/official",
          title: "Official source",
          snippet: "official source",
          content: "official source",
          sourcePriority: "official",
          outcome: { status: "success" },
          extra: {
            claims_json: JSON.stringify([
              {
                text: "Official source already covers the claim.",
                topicKey: "source-coverage",
                stance: "support"
              }
            ])
          }
        })
      ],
      research: {
        router: () => ({
          primary: "scrapling",
          fallbacks: [],
          rule: "web/public-mirror"
        }),
        registry: {
          scrapling: makeAdapter("scrapling", async () => {
            throw new Error("repair should not run");
          })
        }
      }
    });

    const storedRun = await readRunRecord(project.project.id, run.run.id);

    expect(storedRun.artifacts).toHaveLength(1);
    expect(storedRun.artifacts[0]?.metadata.repair_pass).toBeUndefined();
    expect(storedRun.evidenceSummary?.hasOfficialOrPrimaryEvidence).toBe(true);
  });

  it("records empty repair attempts in retrievalAttemptGaps without repeating repair", async () => {
    const { project, run } = await setupRun();
    const { executeResearchRun } = await import("@/lib/orchestrator/run-research");
    const { readRunRecord } = await import("@/lib/storage/workspace");
    let repairCalls = 0;

    await executeResearchRun(project.project.id, run.run.id, {
      now: "2026-04-25T00:00:00.000Z",
      gather: async () => [
        buildArtifact({
          id: "community-0",
          adapter: "community-search-json",
          fetcher: "community-search-json",
          sourceType: "community",
          url: "https://reddit.com/r/research/comments/empty-repair",
          title: "Community-only source",
          snippet: "community discussion",
          content: "community discussion",
          sourcePriority: "community",
          outcome: { status: "success" },
          extra: {
            claims_json: JSON.stringify([
              {
                text: "Community source is not enough for source coverage.",
                topicKey: "source-coverage",
                stance: "support"
              }
            ])
          }
        })
      ],
      research: {
        router: () => ({
          primary: "scrapling",
          fallbacks: [],
          rule: "web/public-mirror"
        }),
        registry: {
          scrapling: makeAdapter("scrapling", async () => {
            repairCalls += 1;
            return [];
          })
        }
      }
    });

    const storedRun = await readRunRecord(project.project.id, run.run.id);

    expect(repairCalls).toBe(3);
    expect(storedRun.artifacts).toHaveLength(1);
    expect(storedRun.retrievalAttemptGaps?.summary.emptyResultCount).toBe(3);
    expect(storedRun.retrievalAttemptGaps?.emptyResults.every(
      (gap) => gap.reason === "empty_adapter_result"
    )).toBe(true);
    expect(storedRun.evidenceSummary?.hasOfficialOrPrimaryEvidence).toBe(false);
  });
});
