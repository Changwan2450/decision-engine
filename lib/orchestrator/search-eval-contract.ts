import type { RunRecord } from "@/lib/storage/schema";

export type SearchEvalMetricId =
  | "support_recall_floor"
  | "counterevidence_recall_floor"
  | "false_contradiction_rate"
  | "trust_weighted_source_diversity"
  | "decisive_evidence_position"
  | "manual_rescue_rate"
  | "appropriate_abstention_rate";

export type SearchPrimaryBottleneck =
  | "domain_shifted_recall"
  | "source_competition_ranking"
  | "coverage_floor"
  | "conditional_contradiction_retrieval";

export type SearchEvalCase = {
  id: string;
  runType: "comparison_tradeoff_analysis";
  primaryBottleneck: SearchPrimaryBottleneck;
};

export type SearchSignalSummary = {
  supportEvidenceCount: number;
  counterevidenceCount: number;
  contradictionCount: number;
  falseContradictionRate: number;
  trustWeightedSourceDiversity: number;
  decisiveEvidencePosition: number | null;
  measuredMetrics: SearchEvalMetricId[];
  unmeasuredMetrics: SearchEvalMetricId[];
};

export const SEARCH_EVAL_CONTRACT_VERSION = "2026-04-22.v1";

export const SEARCH_EVAL_METRIC_MATRIX: Record<
  SearchEvalMetricId,
  {
    description: string;
    measurable: boolean;
  }
> = {
  support_recall_floor: {
    description: "핵심 claim을 지지하는 usable evidence가 최소치 이상인지 본다",
    measurable: true
  },
  counterevidence_recall_floor: {
    description: "credible disagreement가 존재할 때 반증 evidence를 회수하는지 본다",
    measurable: true
  },
  false_contradiction_rate: {
    description: "실제론 충돌이 아닌데 contradiction처럼 과대 해석한 비율",
    measurable: true
  },
  trust_weighted_source_diversity: {
    description: "raw count가 아니라 trust-aware source class 다양성을 본다",
    measurable: true
  },
  decisive_evidence_position: {
    description: "결정적인 evidence가 얼마나 이른 순서에 잡히는지 본다",
    measurable: true
  },
  manual_rescue_rate: {
    description: "operator가 직접 query/source를 구조적으로 구해줘야 하는 비율",
    measurable: false
  },
  appropriate_abstention_rate: {
    description: "증거 부족 시 억지 결론 대신 abstain하는 비율",
    measurable: false
  }
};

export const SEARCH_NON_SIGNAL_PROXY_BAN_LIST = [
  "raw_result_count",
  "fanout_depth_alone",
  "latency_without_evidence_gain",
  "click_through_rate",
  "operator_satisfaction_alone"
] as const;

export const SEARCH_POLICY_GUARDRAILS = [
  "retrieval must be budgeted",
  "coverage is a floor objective, not the product thesis",
  "contradiction retrieval is conditional, not global",
  "stopping and abstention are part of search quality"
] as const;

export const DEFAULT_SEARCH_EVAL_CASES: SearchEvalCase[] = [
  {
    id: "react-rsc-vs-spa",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "domain_shifted_recall"
  },
  {
    id: "typescript-monolith-vs-microservices",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "domain_shifted_recall"
  },
  {
    id: "rust-vs-go",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "source_competition_ranking"
  },
  {
    id: "ai-memory-vs-prompt-stuffing",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "conditional_contradiction_retrieval"
  }
] as const;

const sourcePriorityWeight = {
  official: 3,
  primary_data: 3,
  analysis: 2,
  community: 1
} as const;

const MEASURED_SEARCH_METRICS: SearchEvalMetricId[] = [
  "support_recall_floor",
  "counterevidence_recall_floor",
  "false_contradiction_rate",
  "trust_weighted_source_diversity",
  "decisive_evidence_position"
];

const UNMEASURED_SEARCH_METRICS: SearchEvalMetricId[] = [
  "manual_rescue_rate",
  "appropriate_abstention_rate"
];

export function summarizeSearchSignals(record: RunRecord): SearchSignalSummary {
  const artifactOrder = new Map(record.artifacts.map((artifact, index) => [artifact.id, index + 1]));
  const supportEvidenceArtifactIds = new Set(
    record.claims
      .filter((claim) => claim.stance === "support" && typeof claim.artifactId === "string")
      .map((claim) => claim.artifactId)
  );
  const counterevidenceArtifactIds = new Set(
    record.claims
      .filter((claim) => claim.stance === "oppose" && typeof claim.artifactId === "string")
      .map((claim) => claim.artifactId)
  );

  let decisiveEvidencePosition: number | null = null;
  for (const artifactId of supportEvidenceArtifactIds) {
    const position = artifactOrder.get(artifactId);
    if (typeof position === "number") {
      decisiveEvidencePosition =
        decisiveEvidencePosition === null ? position : Math.min(decisiveEvidencePosition, position);
    }
  }

  const trustWeightedSourceDiversity = Array.from(
    new Set(record.artifacts.map((artifact) => artifact.sourcePriority))
  ).reduce((total, priority) => total + sourcePriorityWeight[priority], 0);

  const contradictionCount = record.contradictions.length;
  const falseContradictionRate =
    contradictionCount === 0
      ? 0
      : record.contradictions.filter((entry) => entry.claimIds.length < 2).length / contradictionCount;

  return {
    supportEvidenceCount: supportEvidenceArtifactIds.size,
    counterevidenceCount: counterevidenceArtifactIds.size,
    contradictionCount,
    falseContradictionRate,
    trustWeightedSourceDiversity,
    decisiveEvidencePosition,
    measuredMetrics: MEASURED_SEARCH_METRICS,
    unmeasuredMetrics: UNMEASURED_SEARCH_METRICS
  };
}
