import { buildFailureArtifact } from "@/lib/adapters/contract";
import { createAdapterRegistry, type AdapterRegistry } from "@/lib/adapters/registry";
import { routeUrl, type AdapterChain, type AdapterName } from "@/lib/adapters/router";
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
import { buildDecision } from "@/lib/orchestrator/decision";
import { buildDecisionHistory } from "@/lib/orchestrator/decision-history";
import {
  derivePromotionCandidates,
  deriveProjectInsightPatch,
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
        artifacts.push(
          buildRoutingFailureArtifact({
            adapter: adapterName,
            url,
            sourceType: inferSourceType(chain),
            status: "error",
            errorMessage: "adapter returned no artifacts"
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

export async function executeResearchRun(
  projectId: string,
  runId: string,
  deps?: {
    now?: string;
    gather?: (plan: ResearchPlan) => Promise<SourceArtifact[]>;
  }
) {
  const initialRecord = await readRunRecord(projectId, runId);
  const projectRecord = await readProjectRecord(projectId);
  const existingRunRecords = await listRunRecords(projectId);
  const normalizedInputForContext = planRun(initialRecord).normalizedInput;
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
    kbContext
  );
  const now = deps?.now ?? new Date().toISOString();
  const clarificationQuestions = buildClarificationQuestions(plan.normalizedInput);

  if (shouldClarifyRun(plan.normalizedInput)) {
    return updateRunRecord(projectId, runId, (record) => {
      assertRunTransition(record.run.status, "awaiting_clarification");
      return {
        ...record,
        normalizedInput: plan.normalizedInput,
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
    const artifacts = [
      ...buildKnowledgeArtifacts(plan.kbContext, plan.runId),
      ...gatheredArtifacts
    ];

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

    const finalRecord = await updateRunRecord(projectId, runId, (record) => {
      assertRunTransition(record.run.status, "decided");
      return {
        ...record,
        normalizedInput: plan.normalizedInput,
        kbContext: plan.kbContext,
        artifacts: synthesis.artifacts,
        claims: synthesis.claims,
        citations: synthesis.citations,
        contradictions: synthesis.contradictions,
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
