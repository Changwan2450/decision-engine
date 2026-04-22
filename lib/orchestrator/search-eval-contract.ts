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
  languageMix: "korean_english_mixed" | "english_only";
  heldOut: boolean;
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

export type SearchEvalCaseSummary = {
  totalCases: number;
  heldOutCases: number;
  bottleneckCounts: Record<SearchPrimaryBottleneck, number>;
  runTypeCounts: Record<SearchEvalCase["runType"], number>;
  languageMixCounts: Record<SearchEvalCase["languageMix"], number>;
};

export type RetrievalPolicyProfile = {
  maxSourceBranches: number;
  maxQueryExpansionsPerBranch: number;
  contradictionMode: "disabled" | "conditional" | "required";
  stopRule: string;
  abstainRule: string;
};

export type CoverageFloorRequirements = {
  minimumUsableEvidencePerCase: number;
  minimumTrustClassesPerCase: number;
  maxPlaceholderOrAuthLeaks: number;
  maxAllowedCoverageOnlyCases: number;
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
    primaryBottleneck: "domain_shifted_recall",
    languageMix: "korean_english_mixed",
    heldOut: false
  },
  {
    id: "typescript-monolith-vs-microservices",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "domain_shifted_recall",
    languageMix: "korean_english_mixed",
    heldOut: false
  },
  {
    id: "rust-vs-go",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "source_competition_ranking",
    languageMix: "korean_english_mixed",
    heldOut: false
  },
  {
    id: "ai-memory-vs-prompt-stuffing",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "conditional_contradiction_retrieval",
    languageMix: "korean_english_mixed",
    heldOut: false
  }
] as const;

export const DOMAIN_SHIFTED_SEARCH_EVAL_CASES: SearchEvalCase[] = [
  {
    id: "react-rsc-vs-spa",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "domain_shifted_recall",
    languageMix: "korean_english_mixed",
    heldOut: false
  },
  {
    id: "typescript-monolith-vs-microservices",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "domain_shifted_recall",
    languageMix: "korean_english_mixed",
    heldOut: false
  },
  {
    id: "nextjs-app-router-vs-spa",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "domain_shifted_recall",
    languageMix: "english_only",
    heldOut: true
  },
  {
    id: "rag-vs-long-context-korean",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "domain_shifted_recall",
    languageMix: "korean_english_mixed",
    heldOut: true
  },
  {
    id: "postgres-rls-vs-app-authorization",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "domain_shifted_recall",
    languageMix: "english_only",
    heldOut: true
  },
  {
    id: "otel-vs-vendor-apm",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "domain_shifted_recall",
    languageMix: "korean_english_mixed",
    heldOut: true
  }
] as const;

export const SOURCE_COMPETITION_SEARCH_EVAL_CASES: SearchEvalCase[] = [
  {
    id: "rust-vs-go",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "source_competition_ranking",
    languageMix: "korean_english_mixed",
    heldOut: false
  },
  {
    id: "postgres-rls-vs-app-authorization",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "source_competition_ranking",
    languageMix: "english_only",
    heldOut: true
  },
  {
    id: "otel-vs-vendor-apm",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "source_competition_ranking",
    languageMix: "korean_english_mixed",
    heldOut: true
  },
  {
    id: "react-rsc-vs-spa",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "source_competition_ranking",
    languageMix: "korean_english_mixed",
    heldOut: true
  }
] as const;

export const COVERAGE_FLOOR_REQUIREMENTS: CoverageFloorRequirements = {
  minimumUsableEvidencePerCase: 2,
  minimumTrustClassesPerCase: 2,
  maxPlaceholderOrAuthLeaks: 0,
  maxAllowedCoverageOnlyCases: 3
} as const;

export const COVERAGE_FLOOR_SEARCH_EVAL_CASES: SearchEvalCase[] = [
  {
    id: "ai-memory-vs-prompt-stuffing",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "coverage_floor",
    languageMix: "korean_english_mixed",
    heldOut: false
  },
  {
    id: "react-rsc-vs-spa",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "coverage_floor",
    languageMix: "korean_english_mixed",
    heldOut: false
  },
  {
    id: "rag-vs-long-context-korean",
    runType: "comparison_tradeoff_analysis",
    primaryBottleneck: "coverage_floor",
    languageMix: "korean_english_mixed",
    heldOut: true
  }
] as const;

export const RETRIEVAL_POLICY_PROFILES: Record<
  | "exploratory_scan"
  | "comparison_tradeoff_analysis"
  | "longitudinal_watch"
  | "contradiction_resolution"
  | "pre_decision_verification",
  RetrievalPolicyProfile
> = {
  exploratory_scan: {
    maxSourceBranches: 4,
    maxQueryExpansionsPerBranch: 1,
    contradictionMode: "disabled",
    stopRule: "stop when at least 3 trust classes are represented or branch budget is exhausted",
    abstainRule: "abstain when no usable evidence survives after branch budget is exhausted"
  },
  comparison_tradeoff_analysis: {
    maxSourceBranches: 4,
    maxQueryExpansionsPerBranch: 2,
    contradictionMode: "conditional",
    stopRule: "stop when decisive evidence exists across >=2 trust classes or budget is exhausted",
    abstainRule: "abstain when decisive evidence is absent after branch budget is exhausted"
  },
  longitudinal_watch: {
    maxSourceBranches: 3,
    maxQueryExpansionsPerBranch: 1,
    contradictionMode: "conditional",
    stopRule: "stop when delta evidence is resolved across prior and fresh branches or budget is exhausted",
    abstainRule: "abstain when fresh delta evidence is insufficient at budget boundary"
  },
  contradiction_resolution: {
    maxSourceBranches: 5,
    maxQueryExpansionsPerBranch: 2,
    contradictionMode: "required",
    stopRule: "stop only after both supporting and opposing trust-qualified evidence are present or budget is exhausted",
    abstainRule: "abstain when either support or counterevidence branch is missing at budget boundary"
  },
  pre_decision_verification: {
    maxSourceBranches: 5,
    maxQueryExpansionsPerBranch: 2,
    contradictionMode: "required",
    stopRule: "stop only after freshness and counterevidence checks both succeed or budget is exhausted",
    abstainRule: "abstain when freshness/provenance minimum is unmet at budget boundary"
  }
};

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

export function summarizeSearchEvalCases(cases: SearchEvalCase[]): SearchEvalCaseSummary {
  const bottleneckCounts: Record<SearchPrimaryBottleneck, number> = {
    domain_shifted_recall: 0,
    source_competition_ranking: 0,
    coverage_floor: 0,
    conditional_contradiction_retrieval: 0
  };
  const runTypeCounts: Record<SearchEvalCase["runType"], number> = {
    comparison_tradeoff_analysis: 0
  };
  const languageMixCounts: Record<SearchEvalCase["languageMix"], number> = {
    korean_english_mixed: 0,
    english_only: 0
  };

  for (const entry of cases) {
    bottleneckCounts[entry.primaryBottleneck] += 1;
    runTypeCounts[entry.runType] += 1;
    languageMixCounts[entry.languageMix] += 1;
  }

  return {
    totalCases: cases.length,
    heldOutCases: cases.filter((entry) => entry.heldOut).length,
    bottleneckCounts,
    runTypeCounts,
    languageMixCounts
  };
}
