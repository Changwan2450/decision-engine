import { buildFailureArtifact } from "@/lib/adapters/contract";
import { createAdapterRegistry, type AdapterRegistry } from "@/lib/adapters/registry";
import { routeUrl, type AdapterChain, type AdapterName } from "@/lib/adapters/router";
import { inferSourceTier } from "@/lib/adapters/source-tier";
import type { ResearchPlan, SourceArtifact, SourceTarget } from "@/lib/adapters/types";
import { getResearchBudgetConfig, type ResearchBudgetConfig } from "@/lib/config";
import { assertRunTransition } from "@/lib/domain/runs";
import {
  exportDecisionHistoryToObsidian,
  exportInsightsToObsidian,
  exportRunToObsidian,
  syncRunToKnowledgeBase
} from "@/lib/export/obsidian";
import { buildClarificationQuestions, shouldClarifyRun } from "@/lib/orchestrator/clarify";
import { classifyContradictionKind } from "@/lib/orchestrator/contradiction-kind";
import { buildDecision } from "@/lib/orchestrator/decision";
import { buildDecisionHistory } from "@/lib/orchestrator/decision-history";
import {
  derivePromotionCandidates,
  deriveProjectInsightPatch,
  deriveProjectMemoryPatch,
  synthesizeEvidenceFromArtifacts
} from "@/lib/orchestrator/insights";
import { buildKnowledgeArtifacts, buildKnowledgeContext } from "@/lib/orchestrator/kb-context";
import { planRun } from "@/lib/orchestrator/plan-run";
import { buildPrdSeed } from "@/lib/orchestrator/prd-seed";
import {
  findRunRecordById,
  listRunRecords,
  readProjectRecord,
  readRunRecord,
  updateProjectRecord,
  updateRunRecord
} from "@/lib/storage/workspace";
import type { ProjectRecord } from "@/lib/storage/schema";
import type { Claim, Citation, Contradiction, SourceArtifactRecord, SourceTier } from "@/lib/domain/claims";

type RunResearchDeps = {
  registry?: AdapterRegistry;
  router?: (url: string) => AdapterChain;
  budgets?: Partial<ResearchBudgetConfig>;
  nowMs?: () => number;
};

export async function runResearch(
  plan: ResearchPlan,
  deps?: RunResearchDeps
): Promise<SourceArtifact[]> {
  const registry = deps?.registry ?? createAdapterRegistry();
  const router = deps?.router ?? routeUrl;
  const budget = {
    ...getResearchBudgetConfig(),
    ...deps?.budgets
  };
  const nowMs = deps?.nowMs ?? (() => Date.now());
  const totalStartedAt = nowMs();
  let fallbackSpentMs = 0;
  const artifacts: SourceArtifact[] = [];

  for (const url of plan.normalizedInput.urls) {
    const chain = router(url);
    const attempts: AdapterName[] = [chain.primary, ...chain.fallbacks];
    const urlStartedAt = nowMs();

    for (const [index, adapterName] of attempts.entries()) {
      const isFallback = index > 0;
      const allowedMs = computeAllowedMs({
        budget,
        nowMs,
        totalStartedAt,
        urlStartedAt,
        fallbackSpentMs,
        isFallback
      });

      if (allowedMs <= 0) {
        artifacts.push(
          buildRoutingFailureArtifact({
            adapter: adapterName,
            url,
            sourceType: inferSourceType(chain),
            status: isFallback ? "error" : "timeout",
            errorMessage: isFallback
              ? "fallback skipped: budget exhausted"
              : "primary skipped: budget exhausted"
          })
        );
        break;
      }

      const adapter = registry[adapterName];
      if (!adapter) {
        artifacts.push(
          buildRoutingFailureArtifact({
            adapter: adapterName,
            url,
            sourceType: inferSourceType(chain),
            status: "error",
            errorMessage: `adapter not registered: ${adapterName}`
          })
        );
        continue;
      }

      const attemptPlan = singleUrlPlan(plan, url);
      if (!adapter.supports(attemptPlan)) {
        artifacts.push(
          buildRoutingFailureArtifact({
            adapter: adapterName,
            url,
            sourceType: inferSourceType(chain),
            status: "error",
            errorMessage: `adapter does not support routed plan: ${adapterName}`
          })
        );
        continue;
      }

      const startedAt = nowMs();
      let attemptArtifacts: SourceArtifact[];
      try {
        attemptArtifacts = await adapter.execute(attemptPlan);
      } catch (error) {
        attemptArtifacts = [
          buildRoutingFailureArtifact({
            adapter: adapterName,
            url,
            sourceType: inferSourceType(chain),
            status: "error",
            errorMessage: error instanceof Error ? error.message : String(error)
          })
        ];
      }

      const elapsedMs = Math.max(0, nowMs() - startedAt);
      if (isFallback) fallbackSpentMs += elapsedMs;

      if (elapsedMs > allowedMs) {
        artifacts.push(
          buildRoutingFailureArtifact({
            adapter: adapterName,
            url,
            sourceType: inferSourceType(chain),
            status: "timeout",
            errorMessage: `budget exceeded after ${elapsedMs}ms (limit ${allowedMs}ms)`
          })
        );
        continue;
      }

      if (attemptArtifacts.length === 0) {
        console.warn(
          "[run-research] empty adapter result",
          JSON.stringify({
            adapter: adapterName,
            url,
            rule: chain.rule,
            isFallback
          })
        );
        continue;
      }

      artifacts.push(...attemptArtifacts);

      if (attemptArtifacts.some(isUsableArtifact)) {
        break;
      }
    }
  }

  return artifacts;
}

export async function fetchWeb(
  url: string,
  deps?: RunResearchDeps
): Promise<SourceArtifact> {
  try {
    const artifacts = await runResearch(
      {
        projectId: "mcp",
        runId: "fetch-web",
        title: url,
        mode: "standard",
        normalizedInput: {
          title: url,
          naturalLanguage: "",
          pastedContent: "",
          urls: [url],
          goal: "",
          target: "",
          comparisonAxis: ""
        },
        sourceTargets: ["web", "community", "video", "github", "pdf"],
        kbContext: null
      },
      deps
    );
    return selectRepresentativeArtifact(artifacts, url);
  } catch (error) {
    return buildFailureArtifact({
      id: "mcp-fetch-web-0",
      adapter: "mcp/fetch_web",
      fetcher: "mcp/fetch_web",
      url,
      sourceType: "web",
      outcome: { status: "error" },
      errorMessage: error instanceof Error ? error.message : String(error),
      sourceLabel: "web/error"
    });
  }
}

export async function gatherForRun(
  runId: string,
  deps?: RunResearchDeps
): Promise<SourceArtifact[]> {
  try {
    const found = await findRunRecordById(runId);
    if (!found) {
      return [
        buildFailureArtifact({
          id: "gather-for-run-0",
          adapter: "mcp/gather_for_run",
          fetcher: "mcp/gather_for_run",
          url: "",
          sourceType: "web",
          outcome: { status: "error" },
          errorMessage: `run not found: ${runId}`,
          sourceLabel: "web/error"
        })
      ];
    }

    const planned = planRun(found.record, found.record.kbContext);
    const plan: ResearchPlan = found.record.normalizedInput
      ? {
          ...planned,
          normalizedInput: found.record.normalizedInput
        }
      : planned;

    return runResearch(plan, deps);
  } catch (error) {
    return [
      buildFailureArtifact({
        id: "gather-for-run-0",
        adapter: "mcp/gather_for_run",
        fetcher: "mcp/gather_for_run",
        url: "",
        sourceType: "web",
        outcome: { status: "error" },
        errorMessage: error instanceof Error ? error.message : String(error),
        sourceLabel: "web/error"
      })
    ];
  }
}

function isRecencySensitive(plan: ResearchPlan): boolean {
  const haystack = [
    plan.title,
    plan.normalizedInput.goal,
    plan.normalizedInput.naturalLanguage,
    plan.normalizedInput.pastedContent
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /(trend|news|latest|최근|트렌드|뉴스)/.test(haystack);
}

function mergeUnique(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right]));
}

function mergeDecisionLedger(
  left: NonNullable<ProjectRecord["memory"]>["decisionLedger"],
  right: NonNullable<ProjectRecord["memory"]>["decisionLedger"]
): NonNullable<ProjectRecord["memory"]>["decisionLedger"] {
  const merged = new Map<string, ProjectRecord["memory"]["decisionLedger"][number]>(
    left.map((entry) => [entry.runId, entry])
  );
  for (const entry of right) {
    merged.set(entry.runId, entry);
  }
  return Array.from(merged.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12);
}

function mergeTopicLedger(
  left: NonNullable<ProjectRecord["memory"]>["topicLedger"],
  right: NonNullable<ProjectRecord["memory"]>["topicLedger"]
): NonNullable<ProjectRecord["memory"]>["topicLedger"] {
  const merged = new Map<string, ProjectRecord["memory"]["topicLedger"][number]>(
    left.map((entry) => [entry.topicKey, { ...entry }])
  );
  for (const entry of right) {
    const current = merged.get(entry.topicKey);
    if (!current) {
      merged.set(entry.topicKey, { ...entry });
      continue;
    }
    merged.set(entry.topicKey, {
      topicKey: entry.topicKey,
      count: current.count + entry.count,
      highTrustCount: current.highTrustCount + entry.highTrustCount,
      lastSeenAt: entry.lastSeenAt > current.lastSeenAt ? entry.lastSeenAt : current.lastSeenAt
    });
  }
  return Array.from(merged.values())
    .sort((a, b) => b.count - a.count || b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, 24);
}

function mergeContradictionLedger(
  left: NonNullable<ProjectRecord["memory"]>["contradictionLedger"],
  right: NonNullable<ProjectRecord["memory"]>["contradictionLedger"]
): NonNullable<ProjectRecord["memory"]>["contradictionLedger"] {
  const merged = new Map<string, ProjectRecord["memory"]["contradictionLedger"][number]>(
    left.map((entry) => [entry.topicKey, { ...entry }])
  );
  for (const entry of right) {
    const current = merged.get(entry.topicKey);
    if (!current) {
      merged.set(entry.topicKey, { ...entry });
      continue;
    }
    merged.set(entry.topicKey, {
      topicKey: entry.topicKey,
      count: current.count + entry.count,
      lastSeenAt: entry.lastSeenAt > current.lastSeenAt ? entry.lastSeenAt : current.lastSeenAt
    });
  }
  return Array.from(merged.values())
    .sort((a, b) => b.count - a.count || b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, 24);
}

function singleUrlPlan(plan: ResearchPlan, url: string): ResearchPlan {
  return {
    ...plan,
    normalizedInput: {
      ...plan.normalizedInput,
      urls: [url]
    }
  };
}

function computeAllowedMs(args: {
  budget: ResearchBudgetConfig;
  nowMs: () => number;
  totalStartedAt: number;
  urlStartedAt: number;
  fallbackSpentMs: number;
  isFallback: boolean;
}): number {
  const totalRemaining =
    args.budget.totalMs - Math.max(0, args.nowMs() - args.totalStartedAt);
  const perUrlRemaining =
    args.budget.perUrlMs - Math.max(0, args.nowMs() - args.urlStartedAt);
  const fallbackRemaining = args.isFallback
    ? args.budget.totalMs * args.budget.fallbackBudgetRatio - args.fallbackSpentMs
    : Number.POSITIVE_INFINITY;

  return Math.floor(
    Math.min(args.budget.perAdapterMs, totalRemaining, perUrlRemaining, fallbackRemaining)
  );
}

function inferSourceType(chain: AdapterChain): SourceTarget {
  if (chain.rule.startsWith("video/")) return "video";
  if (chain.rule === "github") return "github";
  if (chain.rule.startsWith("community/")) return "community";
  if (chain.rule.startsWith("pdf/")) return "pdf";
  return "web";
}

function buildRoutingFailureArtifact(params: {
  adapter: string;
  url: string;
  sourceType: SourceTarget;
  status: "error" | "timeout";
  errorMessage: string;
}): SourceArtifact {
  return buildFailureArtifact({
    id: `${params.adapter}-0`,
    adapter: params.adapter,
    fetcher: params.adapter,
    url: params.url,
    sourceType: params.sourceType,
    outcome: { status: params.status },
    errorMessage: params.errorMessage,
    sourceLabel: `${params.sourceType}/${params.status}`
  });
}

function isUsableArtifact(artifact: SourceArtifact): boolean {
  return (
    artifact.metadata.fetch_status === "success" ||
    artifact.metadata.fetch_status === "partial"
  );
}

function selectRepresentativeArtifact(
  artifacts: SourceArtifact[],
  url: string
): SourceArtifact {
  const best = artifacts.find(isUsableArtifact) ?? artifacts.at(-1);
  if (best) return best;

  return buildFailureArtifact({
    id: "mcp-fetch-web-0",
    adapter: "mcp/fetch_web",
    fetcher: "mcp/fetch_web",
    url,
    sourceType: "web",
    outcome: { status: "error" },
    errorMessage: "no artifacts gathered",
    sourceLabel: "web/error"
  });
}

function attachSourceTiers(artifacts: SourceArtifact[]): SourceArtifact[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    sourceTier: artifact.sourceTier ?? inferSourceTier(artifact.canonicalUrl ?? artifact.url)
  }));
}

function dedupeGatheredArtifacts(artifacts: SourceArtifact[]): SourceArtifact[] {
  const deduped = new Map<string, SourceArtifact>();

  for (const artifact of artifacts) {
    const dedupeKey = artifact.canonicalUrl ?? artifact.url;
    if (!dedupeKey) {
      continue;
    }

    const existing = deduped.get(dedupeKey);
    if (!existing) {
      deduped.set(dedupeKey, artifact);
      continue;
    }

    deduped.set(dedupeKey, pickPreferredArtifact(existing, artifact));
  }

  return Array.from(deduped.values());
}

function pickPreferredArtifact(current: SourceArtifact, candidate: SourceArtifact): SourceArtifact {
  const currentRank = fetchStatusRank(current.metadata.fetch_status);
  const candidateRank = fetchStatusRank(candidate.metadata.fetch_status);

  if (candidateRank !== currentRank) {
    return candidateRank > currentRank ? candidate : current;
  }

  if (candidate.content.length !== current.content.length) {
    return candidate.content.length > current.content.length ? candidate : current;
  }

  if (candidate.snippet.length !== current.snippet.length) {
    return candidate.snippet.length > current.snippet.length ? candidate : current;
  }

  return candidate;
}

function fetchStatusRank(status: string | undefined): number {
  switch (status) {
    case "success":
      return 4;
    case "partial":
      return 3;
    case "blocked":
      return 2;
    case "timeout":
      return 1;
    default:
      return 0;
  }
}

function resolveTierForClaim(
  claim: Claim | undefined,
  citationById: Map<string, Citation>,
  artifactById: Map<string, SourceArtifactRecord>
): SourceTier | null {
  if (!claim) return null;

  // TODO(SI3-v2): consider multiple citation tiers instead of first-citation fallback.
  for (const citationId of claim.citationIds) {
    const citation = citationById.get(citationId);
    const artifact = citation ? artifactById.get(citation.artifactId) : undefined;
    if (artifact?.sourceTier) {
      return artifact.sourceTier;
    }
  }

  return null;
}

function attachContradictionKinds(
  contradictions: Contradiction[],
  claims: Claim[],
  citations: Citation[],
  artifacts: SourceArtifactRecord[]
): Contradiction[] {
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const citationById = new Map(citations.map((citation) => [citation.id, citation]));
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));

  return contradictions.map((contradiction) => {
    const [claimIdA, claimIdB] = contradiction.claimIds;
    const tierA = resolveTierForClaim(claimById.get(claimIdA), citationById, artifactById);
    const tierB = resolveTierForClaim(claimById.get(claimIdB), citationById, artifactById);

    if (!tierA || !tierB) {
      return contradiction;
    }

    return {
      ...contradiction,
      kind: classifyContradictionKind(tierA, tierB),
      tierA,
      tierB
    };
  });
}

export async function executeResearchRun(
  projectId: string,
  runId: string,
  deps?: {
    now?: string;
    gather?: (plan: ResearchPlan) => Promise<SourceArtifact[]>;
  }
) {
  const now = deps?.now ?? new Date().toISOString();
  const nowDate = new Date(now);
  const initialRecord = await readRunRecord(projectId, runId);
  const projectRecord = await readProjectRecord(projectId);
  const existingRunRecords = await listRunRecords(projectId);
  const normalizedInputForContext = planRun(initialRecord, null, { now: nowDate }).normalizedInput;
  const kbContext = await buildKnowledgeContext({
    record: {
      ...initialRecord,
      normalizedInput: normalizedInputForContext
    },
    projectRecord,
    runRecords: existingRunRecords
  });
  const plan = planRun(
    {
      ...initialRecord,
      normalizedInput: normalizedInputForContext
    },
    kbContext,
    { now: nowDate }
  );
  const clarificationQuestions = buildClarificationQuestions(plan.normalizedInput);

  if (shouldClarifyRun(plan.normalizedInput)) {
    return updateRunRecord(projectId, runId, (record) => {
      assertRunTransition(record.run.status, "awaiting_clarification");
      return {
        ...record,
        normalizedInput: plan.normalizedInput,
        expansion: plan.expansion ?? null,
        kbContext: plan.kbContext,
        run: {
          ...record.run,
          status: "awaiting_clarification",
          clarificationQuestions,
          updatedAt: now
        }
      };
    });
  }

  await updateRunRecord(projectId, runId, (record) => {
    assertRunTransition(record.run.status, "collecting");
    return {
      ...record,
      normalizedInput: plan.normalizedInput,
      expansion: plan.expansion ?? null,
      kbContext: plan.kbContext,
      run: {
        ...record.run,
        status: "collecting",
        clarificationQuestions: [],
        updatedAt: now
      }
    };
  });

  try {
    const gather = deps?.gather ?? runResearch;
    const gatheredArtifacts = await gather(plan);
    const artifacts = attachSourceTiers([
      ...buildKnowledgeArtifacts(plan.kbContext, plan.runId),
      ...dedupeGatheredArtifacts(gatheredArtifacts)
    ]);

    await updateRunRecord(projectId, runId, (record) => {
      assertRunTransition(record.run.status, "synthesizing");
      return {
        ...record,
        normalizedInput: plan.normalizedInput,
        kbContext: plan.kbContext,
        artifacts,
        run: {
          ...record.run,
          status: "synthesizing",
          updatedAt: now
        }
      };
    });

    const synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now,
      recencySensitive: isRecencySensitive(plan)
    });
    const decision = buildDecision(synthesis, {
      runTitle: plan.title,
      goal: plan.normalizedInput.goal ?? plan.title
    });
    const prdSeed = buildPrdSeed(decision, synthesis, {
      runTitle: plan.title,
      target: plan.normalizedInput.target,
      comparisonAxis: plan.normalizedInput.comparisonAxis
    });
    const synthesizedArtifacts = attachSourceTiers(synthesis.artifacts);
    const contradictions = attachContradictionKinds(
      synthesis.contradictions,
      synthesis.claims,
      synthesis.citations,
      synthesizedArtifacts
    );

    const finalRecord = await updateRunRecord(projectId, runId, (record) => {
      assertRunTransition(record.run.status, "decided");
      return {
        ...record,
        normalizedInput: plan.normalizedInput,
        kbContext: plan.kbContext,
        artifacts: synthesizedArtifacts,
        claims: synthesis.claims,
        citations: synthesis.citations,
        contradictions,
        evidenceSummary: synthesis.summary,
        decision,
        prdSeed,
        run: {
          ...record.run,
          status: "decided",
          updatedAt: now
        }
      };
    });

    const patch = deriveProjectInsightPatch(synthesis);
    const memoryPatch = deriveProjectMemoryPatch({
      record: finalRecord,
      synthesis,
      decision,
      now
    });
    const runRecords = await listRunRecords(projectId);
    const promotionCandidates = derivePromotionCandidates(runRecords);
    const updatedProject = await updateProjectRecord(projectId, (projectRecord) => ({
      ...projectRecord,
      insights: {
        repeatedProblems: mergeUnique(
          projectRecord.insights.repeatedProblems,
          patch.repeatedProblems
        ),
        repeatedPatterns: mergeUnique(
          projectRecord.insights.repeatedPatterns,
          patch.repeatedPatterns
        ),
        competitorSignals: mergeUnique(
          projectRecord.insights.competitorSignals,
          patch.competitorSignals
        ),
        contradictionIds: mergeUnique(
          projectRecord.insights.contradictionIds,
          patch.contradictionIds
        )
      },
      memory: {
        decisionLedger: mergeDecisionLedger(
          projectRecord.memory?.decisionLedger ?? [],
          memoryPatch.decisionLedger
        ),
        topicLedger: mergeTopicLedger(
          projectRecord.memory?.topicLedger ?? [],
          memoryPatch.topicLedger
        ),
        contradictionLedger: mergeContradictionLedger(
          projectRecord.memory?.contradictionLedger ?? [],
          memoryPatch.contradictionLedger
        )
      },
      promotionCandidates,
      project: {
        ...projectRecord.project,
        updatedAt: now
      }
    }));

    try {
      const decisionHistory = buildDecisionHistory(updatedProject.project, runRecords);
      await exportRunToObsidian(finalRecord, updatedProject.project);
      await exportInsightsToObsidian(updatedProject.project, updatedProject.insights);
      await exportDecisionHistoryToObsidian(updatedProject.project, decisionHistory);
      await syncRunToKnowledgeBase(finalRecord, updatedProject.project, updatedProject.insights);
    } catch (error) {
      console.error("Obsidian export failed", error);
    }

    return finalRecord;
  } catch (error) {
    await updateRunRecord(projectId, runId, (record) => ({
      ...record,
      run: {
        ...record.run,
        status: "failed",
        updatedAt: now
      }
    }));
    throw error;
  }
}
