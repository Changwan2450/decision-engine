import { createAgentReachAdapter } from "@/lib/adapters/agent-reach";
import { createGeocodingAdapter } from "@/lib/adapters/geocoding";
import { createReclipAdapter } from "@/lib/adapters/reclip";
import type { ResearchPlan, SourceArtifact } from "@/lib/adapters/types";
import {
  exportDecisionHistoryToObsidian,
  exportInsightsToObsidian,
  exportRunToObsidian
} from "@/lib/export/obsidian";
import { assertRunTransition } from "@/lib/domain/runs";
import { buildDecisionHistory } from "@/lib/orchestrator/decision-history";
import { buildDecision } from "@/lib/orchestrator/decision";
import { buildClarificationQuestions, shouldClarifyRun } from "@/lib/orchestrator/clarify";
import {
  derivePromotionCandidates,
  deriveProjectInsightPatch,
  synthesizeEvidenceFromArtifacts
} from "@/lib/orchestrator/insights";
import { planRun } from "@/lib/orchestrator/plan-run";
import { buildPrdSeed } from "@/lib/orchestrator/prd-seed";
import {
  listRunRecords,
  readRunRecord,
  updateProjectRecord,
  updateRunRecord
} from "@/lib/storage/workspace";

const adapters = [
  createAgentReachAdapter(),
  createReclipAdapter(),
  createGeocodingAdapter()
];

export async function runResearch(plan: ResearchPlan): Promise<SourceArtifact[]> {
  const supported = adapters.filter((adapter) => adapter.supports(plan));
  const collected = await Promise.all(supported.map((adapter) => adapter.execute(plan)));
  return collected.flat();
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

export async function executeResearchRun(
  projectId: string,
  runId: string,
  deps?: {
    now?: string;
    gather?: (plan: ResearchPlan) => Promise<SourceArtifact[]>;
  }
) {
  const initialRecord = await readRunRecord(projectId, runId);
  const plan = planRun(initialRecord);
  const now = deps?.now ?? new Date().toISOString();
  const clarificationQuestions = buildClarificationQuestions(plan.normalizedInput);

  if (shouldClarifyRun(plan.normalizedInput)) {
    return updateRunRecord(projectId, runId, (record) => {
      assertRunTransition(record.run.status, "awaiting_clarification");
      return {
        ...record,
        normalizedInput: plan.normalizedInput,
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
    const artifacts = await gather(plan);

    await updateRunRecord(projectId, runId, (record) => {
      assertRunTransition(record.run.status, "synthesizing");
      return {
        ...record,
        normalizedInput: plan.normalizedInput,
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
