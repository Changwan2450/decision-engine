import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function writeRawPayload(rawRef: string, payload: unknown) {
  const absolutePath = path.join(process.env.WORKSPACE_ROOT!, rawRef);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(payload));
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
            if (url.startsWith("https://s.jina.ai/?q=")) {
              return [
                buildArtifact({
                  id: "repair-discovery-1",
                  adapter: "scrapling",
                  fetcher: "scrapling",
                  sourceType: "web",
                  url,
                  title: "Discovery result page",
                  snippet: "links to https://openai.com/research/guardrails and https://arxiv.org/abs/2501.00001",
                  content:
                    "Discovery result page with https://openai.com/research/guardrails and https://arxiv.org/abs/2501.00001",
                  sourcePriority: "analysis",
                  outcome: { status: "success" }
                })
              ];
            }
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
                sourcePriority: url.includes("openai.com") ? "official" : "primary_data",
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
      (artifact) => artifact.metadata.repair_pass === "source_coverage_v1"
    );
    const discoveryArtifacts = repairArtifacts.filter(
      (artifact) => artifact.metadata.repair_stage === "discovery"
    );
    const evidenceArtifacts = repairArtifacts.filter(
      (artifact) => artifact.metadata.repair_stage === "evidence"
    );

    expect(storedRun.run.status).toBe("decided");
    expect(repairUrls).toHaveLength(3);
    expect(repairUrls[0]).toMatch(/^https:\/\/s\.jina\.ai\/\?q=/);
    expect(repairUrls.slice(1)).toEqual([
      "https://openai.com/research/guardrails",
      "https://arxiv.org/abs/2501.00001"
    ]);
    expect(storedRun.artifacts.some((artifact) => artifact.id === "community-0")).toBe(true);
    expect(discoveryArtifacts).toHaveLength(1);
    expect(evidenceArtifacts).toHaveLength(2);
    expect(discoveryArtifacts[0]?.sourceTier).toBe("aggregator");
    expect(discoveryArtifacts[0]?.metadata).toMatchObject({
      repair_pass: "source_coverage_v1",
      repair_stage: "discovery",
      repair_reason: "no_official_or_primary_evidence",
    });
    expect(discoveryArtifacts[0]?.metadata.repair_query.length).toBeLessThanOrEqual(240);
    expect(evidenceArtifacts.every((artifact) => artifact.metadata.repair_stage === "evidence")).toBe(
      true
    );
    expect(evidenceArtifacts[0]?.metadata.repair_discovery_artifact_id).toBe("repair-discovery-1");
    expect(evidenceArtifacts[0]?.metadata.repair_follow_rank).toBe("0");
    expect(evidenceArtifacts[0]?.metadata.repair_source_host_class).toBe("official");
    expect(evidenceArtifacts[1]?.metadata.repair_source_host_class).toBe("primary");
    expect(storedRun.evidenceSummary?.hasOfficialOrPrimaryEvidence).toBe(true);
    expect(storedRun.evidenceSummary?.sourcePriorityCounts?.official).toBe(1);
    expect(storedRun.evidenceSummary?.sourcePriorityCounts?.primary_data).toBe(1);
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

    expect(repairCalls).toBe(1);
    expect(storedRun.artifacts).toHaveLength(1);
    expect(storedRun.retrievalAttemptGaps?.summary.emptyResultCount).toBe(1);
    expect(storedRun.retrievalAttemptGaps?.emptyResults.every(
      (gap) => gap.reason === "empty_adapter_result"
    )).toBe(true);
    expect(storedRun.evidenceSummary?.hasOfficialOrPrimaryEvidence).toBe(false);
  });

  it("does not follow discovery artifacts when no allowlisted direct URLs are found", async () => {
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
          url: "https://reddit.com/r/research/comments/discovery-only",
          title: "Community-only source",
          snippet: "community discussion",
          content: "community discussion",
          sourcePriority: "community",
          outcome: { status: "success" }
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
                id: "repair-discovery-only",
                adapter: "scrapling",
                fetcher: "scrapling",
                sourceType: "web",
                url,
                title: "Discovery result page",
                snippet: "only https://news.ycombinator.com/item?id=1 and https://reddit.com/r/test",
                content: "only community links",
                sourcePriority: "analysis",
                outcome: { status: "success" }
              })
            ];
          })
        }
      }
    });

    const storedRun = await readRunRecord(project.project.id, run.run.id);
    const repairArtifacts = storedRun.artifacts.filter(
      (artifact) => artifact.metadata.repair_pass === "source_coverage_v1"
    );

    expect(repairUrls).toEqual([expect.stringMatching(/^https:\/\/s\.jina\.ai\/\?q=/)]);
    expect(repairArtifacts).toHaveLength(1);
    expect(repairArtifacts[0]?.metadata.repair_stage).toBe("discovery");
    expect(repairArtifacts[0]?.metadata.repair_fallback_attempted).toBe("true");
    expect(repairArtifacts[0]?.metadata.repair_fallback_source).toBe("community_search_json");
    expect(repairArtifacts[0]?.metadata.repair_fallback_candidate_count).toBe("0");
    expect(repairArtifacts[0]?.metadata.repair_fallback_allowed_url_count).toBe("0");
    expect(repairArtifacts[0]?.metadata.repair_fallback_raw_sources_checked).toBe("0");
    expect(storedRun.evidenceSummary?.hasOfficialOrPrimaryEvidence).toBe(false);
  });

  it("falls back to community raw payload discovery when primary discovery is blocked", async () => {
    const { project, run } = await setupRun();
    const { executeResearchRun } = await import("@/lib/orchestrator/run-research");
    const { readRunRecord } = await import("@/lib/storage/workspace");
    const rawRef =
      `${project.project.id}/runs/${run.run.id}/raw/community-search-json/fallback.json`;
    await writeRawPayload(rawRef, {
      hits: [
        { url: "https://news.ycombinator.com/item?id=1" },
        { url: "https://openai.com/research/guardrails" },
        { url: "https://arxiv.org/abs/2501.00001" }
      ]
    });
    const repairUrls: string[] = [];

    await executeResearchRun(project.project.id, run.run.id, {
      now: "2026-04-25T00:00:00.000Z",
      gather: async () => [
        buildArtifact({
          id: "community-search-0",
          adapter: "community-search-json",
          fetcher: "community-search-json",
          sourceType: "community",
          url: "https://hn.algolia.com/api/v1/search?query=false+convergence",
          title: "HN search result item",
          snippet: "search result",
          content: "search result",
          sourcePriority: "community",
          rawRef,
          outcome: { status: "success" }
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
            if (url.startsWith("https://s.jina.ai/?q=")) {
              return [
                buildArtifact({
                  id: "repair-discovery-blocked",
                  adapter: "scrapling",
                  fetcher: "scrapling",
                  sourceType: "web",
                  url,
                  title: "s.jina.ai",
                  snippet: "",
                  content: "",
                  sourcePriority: "analysis",
                  outcome: {
                    status: "blocked",
                    blockReason: "login",
                    bypassLevel: "headers",
                    loginRequired: true
                  }
                })
              ];
            }
            return [
              buildArtifact({
                id: `repair-follow-${repairUrls.length}`,
                adapter: "scrapling",
                fetcher: "scrapling",
                sourceType: "web",
                url,
                title: "Direct repair evidence",
                snippet: "direct evidence",
                content: "direct evidence",
                sourcePriority: url.includes("openai.com") ? "official" : "primary_data",
                outcome: { status: "success" }
              })
            ];
          })
        }
      }
    });

    const storedRun = await readRunRecord(project.project.id, run.run.id);
    const discoveryFallbackArtifacts = storedRun.artifacts.filter(
      (artifact) => artifact.metadata.repair_stage === "discovery_fallback"
    );
    const repairEvidenceArtifacts = storedRun.artifacts.filter(
      (artifact) => artifact.metadata.repair_stage === "evidence"
    );

    expect(repairUrls).toEqual([
      expect.stringMatching(/^https:\/\/s\.jina\.ai\/\?q=/),
      "https://openai.com/research/guardrails",
      "https://arxiv.org/abs/2501.00001"
    ]);
    expect(discoveryFallbackArtifacts).toHaveLength(1);
    expect(discoveryFallbackArtifacts[0]?.metadata.repair_discovery_source).toBe(
      "community_search_json"
    );
    expect(discoveryFallbackArtifacts[0]?.sourcePriority).toBe("community");
    const primaryDiscoveryArtifact = storedRun.artifacts.find(
      (artifact) => artifact.metadata.repair_stage === "discovery"
    );
    expect(primaryDiscoveryArtifact?.metadata.repair_fallback_attempted).toBe("true");
    expect(primaryDiscoveryArtifact?.metadata.repair_fallback_source).toBe("community_search_json");
    expect(primaryDiscoveryArtifact?.metadata.repair_fallback_candidate_count).toBe("2");
    expect(primaryDiscoveryArtifact?.metadata.repair_fallback_allowed_url_count).toBe("2");
    expect(primaryDiscoveryArtifact?.metadata.repair_fallback_raw_sources_checked).toBe("1");
    expect(repairEvidenceArtifacts).toHaveLength(2);
    expect(repairEvidenceArtifacts.every((artifact) => artifact.metadata.repair_stage === "evidence")).toBe(
      true
    );
    expect(storedRun.evidenceSummary?.hasOfficialOrPrimaryEvidence).toBe(true);
  });
});
