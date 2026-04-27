import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildArtifact } from "@/lib/adapters/contract";
import type { DomainTargetedDiscoveryResult } from "@/lib/adapters/domain-targeted-search";
import type { ResearchAdapter, ResearchPlan, SourceArtifact } from "@/lib/adapters/types";
import { buildCliBundle } from "@/lib/bridge/cli-bundle";
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

function makeDomainDiscoveryResult(
  query: string,
  candidates: DomainTargetedDiscoveryResult["candidates"],
  errors: string[] = []
): DomainTargetedDiscoveryResult {
  return {
    query,
    source: "domain-targeted-search",
    candidates,
    rawResultCount: candidates.length,
    allowedResultCount: candidates.length,
    errors
  };
}

function supportArtifact(): SourceArtifact {
  return buildArtifact({
    id: "official-support-0",
    adapter: "scrapling",
    fetcher: "scrapling",
    sourceType: "web",
    url: "https://openai.com/research/evidence-checks",
    title: "Official support",
    snippet: "official support",
    content: "official support",
    sourcePriority: "official",
    outcome: { status: "success" },
    extra: {
      claims_json: JSON.stringify([
        {
          text: "Research agents should avoid false convergence with evidence checks.",
          topicKey: "false-convergence",
          stance: "support"
        }
      ])
    }
  });
}

function opposeArtifact(): SourceArtifact {
  return buildArtifact({
    id: "analysis-oppose-0",
    adapter: "scrapling",
    fetcher: "scrapling",
    sourceType: "web",
    url: "https://example.com/oppose",
    title: "Oppose analysis",
    snippet: "oppose analysis",
    content: "oppose analysis",
    sourcePriority: "analysis",
    outcome: { status: "success" },
    extra: {
      claims_json: JSON.stringify([
        {
          text: "Research agents should not add extra evidence checks.",
          topicKey: "false-convergence",
          stance: "oppose"
        }
      ])
    }
  });
}

async function setupRun() {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "research-counter-repair-"));
  tempVault = await mkdtemp(path.join(os.tmpdir(), "research-counter-repair-vault-"));
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
    name: "Counterevidence repair",
    description: "bounded repair"
  });
  const run = await createRunRecord(project.project.id, {
    title: "False convergence safeguards",
    naturalLanguage:
      "목표: counterevidence repair 검증\n대상: research agents\n비교: evidence layer vs summary",
    urls: []
  });

  return { project, run };
}

describe("counterevidence repair in executeResearchRun", () => {
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

  it("runs one bounded pass, marks discovery and followed evidence, and re-synthesizes once", async () => {
    const { project, run } = await setupRun();
    const { executeResearchRun } = await import("@/lib/orchestrator/run-research");
    const { readRunRecord } = await import("@/lib/storage/workspace");
    const discoveryQueries: string[] = [];
    const followedUrls: string[] = [];

    await executeResearchRun(project.project.id, run.run.id, {
      now: "2026-04-25T00:00:00.000Z",
      gather: async () => [supportArtifact()],
      research: {
        domainTargetedDiscover: async (query) => {
          discoveryQueries.push(query);
          return makeDomainDiscoveryResult(query, [
            {
              url: "https://example.com/limitations",
              title: "Limitations",
              hostClass: "primary"
            },
            {
              url: "https://example.com/risks",
              title: "Risks",
              hostClass: "primary"
            },
            {
              url: "https://example.com/failure-cases",
              title: "Failure cases",
              hostClass: "primary"
            }
          ]);
        },
        router: () => ({
          primary: "scrapling",
          fallbacks: [],
          rule: "web/public-mirror"
        }),
        registry: {
          scrapling: makeAdapter("scrapling", async (plan) => {
            const url = plan.normalizedInput.urls[0] ?? "";
            followedUrls.push(url);
            return [
              buildArtifact({
                id: `counter-follow-${followedUrls.length}`,
                adapter: "scrapling",
                fetcher: "scrapling",
                sourceType: "web",
                url,
                title: "Counterevidence limitation",
                snippet: "limitation",
                content: "limitation",
                sourcePriority: "analysis",
                outcome: { status: "success" },
                extra: {
                  claims_json: JSON.stringify([
                    {
                      text: "Evidence checks have practical limitations in open-ended research.",
                      topicKey: "false-convergence",
                      stance: "neutral"
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
    const counterArtifacts = storedRun.artifacts.filter(
      (artifact) => artifact.metadata.repair_pass === "counterevidence_v0"
    );
    const discoveryArtifacts = counterArtifacts.filter(
      (artifact) => artifact.metadata.repair_stage === "discovery"
    );
    const evidenceArtifacts = counterArtifacts.filter(
      (artifact) => artifact.metadata.repair_stage === "evidence"
    );

    expect(discoveryQueries).toHaveLength(1);
    expect(followedUrls).toEqual([
      "https://example.com/limitations",
      "https://example.com/risks"
    ]);
    expect(discoveryArtifacts).toHaveLength(1);
    expect(discoveryArtifacts[0]?.metadata).toMatchObject({
      repair_pass: "counterevidence_v0",
      repair_stage: "discovery",
      repair_query: discoveryQueries[0],
      repair_candidate_count: "3",
      repair_allowed_url_count: "3",
      repair_discovery_error_count: "0",
      repair_counterevidence_kind: "limitation"
    });
    expect(evidenceArtifacts).toHaveLength(2);
    expect(evidenceArtifacts[0]?.metadata).toMatchObject({
      repair_pass: "counterevidence_v0",
      repair_stage: "evidence",
      repair_follow_rank: "0",
      repair_counterevidence_kind: "limitation",
      repair_source_host_class: "analysis"
    });
    expect(storedRun.claims.map((claim) => claim.artifactId)).toContain("counter-follow-1");
    expect(storedRun.evidenceSummary?.counterevidenceChecked).toBe(false);
    expect(storedRun.decision).not.toBeNull();
  });

  it("does not trigger for opposed or contradictory evidence", async () => {
    const { project, run } = await setupRun();
    const { executeResearchRun } = await import("@/lib/orchestrator/run-research");
    const { readRunRecord } = await import("@/lib/storage/workspace");
    let discoveryCalls = 0;

    await executeResearchRun(project.project.id, run.run.id, {
      now: "2026-04-25T00:00:00.000Z",
      gather: async () => [supportArtifact(), opposeArtifact()],
      research: {
        domainTargetedDiscover: async (query) => {
          discoveryCalls += 1;
          return makeDomainDiscoveryResult(query, []);
        }
      }
    });

    const storedRun = await readRunRecord(project.project.id, run.run.id);
    expect(discoveryCalls).toBe(0);
    expect(
      storedRun.artifacts.some((artifact) => artifact.metadata.repair_pass === "counterevidence_v0")
    ).toBe(false);
    expect(storedRun.contradictions.length).toBeGreaterThan(0);
  });

  it("runs max 2 discovery queries, tracks no-candidate metadata, and does not recurse", async () => {
    const { project, run } = await setupRun();
    const { executeResearchRun } = await import("@/lib/orchestrator/run-research");
    const { readRunRecord } = await import("@/lib/storage/workspace");
    const discoveryQueries: string[] = [];

    await executeResearchRun(project.project.id, run.run.id, {
      now: "2026-04-25T00:00:00.000Z",
      gather: async () => [supportArtifact()],
      research: {
        domainTargetedDiscover: async (query) => {
          discoveryQueries.push(query);
          return makeDomainDiscoveryResult(query, [], ["no_result_links_found"]);
        }
      }
    });

    const storedRun = await readRunRecord(project.project.id, run.run.id);
    const discoveryArtifacts = storedRun.artifacts.filter(
      (artifact) =>
        artifact.metadata.repair_pass === "counterevidence_v0" &&
        artifact.metadata.repair_stage === "discovery"
    );

    expect(discoveryQueries).toHaveLength(2);
    expect(discoveryArtifacts).toHaveLength(2);
    expect(discoveryArtifacts.map((artifact) => artifact.metadata.repair_candidate_count)).toEqual([
      "0",
      "0"
    ]);
    expect(discoveryArtifacts.map((artifact) => artifact.metadata.repair_allowed_url_count)).toEqual([
      "0",
      "0"
    ]);
    expect(discoveryArtifacts.map((artifact) => artifact.metadata.repair_discovery_error_count)).toEqual([
      "1",
      "1"
    ]);
    expect(storedRun.claims.map((claim) => claim.artifactId)).toEqual(["official-support-0"]);
  });

  it("limits discovery candidates to 5 and followed URLs to 2", async () => {
    const { project, run } = await setupRun();
    const { executeResearchRun } = await import("@/lib/orchestrator/run-research");
    const { readRunRecord } = await import("@/lib/storage/workspace");
    const followedUrls: string[] = [];

    await executeResearchRun(project.project.id, run.run.id, {
      now: "2026-04-25T00:00:00.000Z",
      gather: async () => [supportArtifact()],
      research: {
        domainTargetedDiscover: async (query) =>
          makeDomainDiscoveryResult(
            query,
            Array.from({ length: 7 }, (_, index) => ({
              url: `https://example.com/counter-${index}`,
              title: `Counter ${index}`,
              hostClass: "primary" as const
            }))
          ),
        router: () => ({
          primary: "scrapling",
          fallbacks: [],
          rule: "web/public-mirror"
        }),
        registry: {
          scrapling: makeAdapter("scrapling", async (plan) => {
            const url = plan.normalizedInput.urls[0] ?? "";
            followedUrls.push(url);
            return [
              buildArtifact({
                id: `counter-bounded-${followedUrls.length}`,
                adapter: "scrapling",
                fetcher: "scrapling",
                sourceType: "web",
                url,
                title: "Counter bounded",
                snippet: "counter bounded",
                content: "counter bounded",
                sourcePriority: "analysis",
                outcome: { status: "success" }
              })
            ];
          })
        }
      }
    });

    const storedRun = await readRunRecord(project.project.id, run.run.id);
    const discovery = storedRun.artifacts.find(
      (artifact) =>
        artifact.metadata.repair_pass === "counterevidence_v0" &&
        artifact.metadata.repair_stage === "discovery"
    );
    const followed = storedRun.artifacts.filter(
      (artifact) =>
        artifact.metadata.repair_pass === "counterevidence_v0" &&
        artifact.metadata.repair_stage === "evidence"
    );

    expect(discovery?.metadata.repair_candidate_count).toBe("5");
    expect(discovery?.metadata.repair_allowed_url_count).toBe("5");
    expect(followedUrls).toHaveLength(2);
    expect(followed).toHaveLength(2);
  });

  it("marks failed follows for bridge export without counting them in synthesis", async () => {
    const { project, run } = await setupRun();
    const { executeResearchRun } = await import("@/lib/orchestrator/run-research");
    const { readProjectRecord, readRunRecord } = await import("@/lib/storage/workspace");

    await executeResearchRun(project.project.id, run.run.id, {
      now: "2026-04-25T00:00:00.000Z",
      gather: async () => [supportArtifact()],
      research: {
        domainTargetedDiscover: async (query) =>
          makeDomainDiscoveryResult(query, [
            {
              url: "https://example.com/timeout",
              title: "Timeout",
              hostClass: "primary"
            }
          ]),
        router: () => ({
          primary: "scrapling",
          fallbacks: [],
          rule: "web/public-mirror"
        }),
        registry: {
          scrapling: makeAdapter("scrapling", async (plan) => [
            buildArtifact({
              id: "counter-timeout-0",
              adapter: "scrapling",
              fetcher: "scrapling",
              sourceType: "web",
              url: plan.normalizedInput.urls[0] ?? "https://example.com/timeout",
              title: "Counter timeout",
              snippet: "",
              content: "",
              sourcePriority: "analysis",
              outcome: { status: "timeout" }
            })
          ])
        }
      }
    });

    const projectRecord = await readProjectRecord(project.project.id);
    const storedRun = await readRunRecord(project.project.id, run.run.id);
    const bundle = buildCliBundle({
      project: projectRecord.project,
      latestRun: storedRun,
      insights: projectRecord.insights,
      decisionHistory: [],
      bridgeConfig: {
        provider: "codex",
        mode: "prompt_only"
      }
    });

    expect(storedRun.claims.map((claim) => claim.artifactId)).toEqual(["official-support-0"]);
    expect(bundle.repairAttempts.counterevidence.followedEvidence.count).toBe(0);
    expect(bundle.repairAttempts.counterevidence.failedFollowAttempts.count).toBe(1);
    expect(bundle.repairAttempts.counterevidence.failedFollowAttempts.artifacts[0]).toMatchObject({
      artifactId: "counter-timeout-0",
      fetchStatus: "timeout",
      repairStage: "evidence",
      repairCounterevidenceKind: "limitation",
      repairFollowRank: "0"
    });
  });
});
