import type { RunRecord } from "@/lib/storage/schema";
import type {
  ResearchRunType,
  ShipBlockerId
} from "@/lib/orchestrator/research-quality-contract";
import {
  BASELINE_HARNESS_RULE,
  NON_COMPENSATORY_SHIP_BLOCKERS
} from "@/lib/orchestrator/research-quality-contract";
import {
  CONDITIONAL_CONTRADICTION_SEARCH_EVAL_CASES,
  COVERAGE_FLOOR_SEARCH_EVAL_CASES,
  DOMAIN_SHIFTED_SEARCH_EVAL_CASES,
  SOURCE_COMPETITION_SEARCH_EVAL_CASES,
  SEARCH_EVAL_CONTRACT_VERSION,
  SEARCH_EVAL_METRIC_MATRIX,
  SEARCH_NON_SIGNAL_PROXY_BAN_LIST,
  SEARCH_POLICY_GUARDRAILS,
  summarizeSearchEvalCases,
  summarizeSearchSignals,
  type SearchEvalMetricId,
  type SearchSignalSummary
} from "@/lib/orchestrator/search-eval-contract";

export type EvaluationBudget = {
  min?: number;
  max?: number;
};

export type EvaluationCase = {
  id: string;
  title: string;
  query: string;
  runType: ResearchRunType;
  tags: string[];
  expected: {
    communityCount: EvaluationBudget;
    supportEvidenceCount?: EvaluationBudget;
    trustWeightedSourceDiversity?: EvaluationBudget;
    contradictionCount: EvaluationBudget;
    leakedAuthClaimCount: EvaluationBudget;
    placeholderCount: EvaluationBudget;
  };
};

export type EvaluationSummary = {
  runId: string;
  title: string;
  communityCount: number;
  supportEvidenceCount: number;
  counterevidenceCount: number;
  trustWeightedSourceDiversity: number;
  decisiveEvidencePosition: number | null;
  contradictionCount: number;
  leakedAuthClaimCount: number;
  placeholderCount: number;
  runAnchors: string[];
  communityTitles: string[];
};

export type EvaluationResult = {
  pass: boolean;
  failures: string[];
};

export type BaselineGuardrailInput = {
  freshNoMemory: EvaluationSummary;
  adaptivePolicyOn: EvaluationSummary;
  projectMemoryOnly?: EvaluationSummary;
  freshnessMinimumViolated?: boolean;
  provenanceCompletenessRegressed?: boolean;
  crossContextContamination?: boolean;
};

export type BaselineGuardrailResult = {
  pass: boolean;
  blockerIds: ShipBlockerId[];
  rollbackTriggered: boolean;
  comparisonRule: string;
  failRule: string;
  rollbackTrigger: string;
};

export type EvaluationCaseResult = {
  id: string;
  runType: ResearchRunType;
  tags: string[];
  summary: EvaluationSummary;
  expected: EvaluationCase["expected"];
  pass: boolean;
  failures: string[];
};

export type EvaluatedRunSample = {
  id: string;
  caseId: string;
  runType: ResearchRunType;
  judgedAt: string;
  basis: "manual_review";
  summary: {
    overall: "good" | "mixed" | "bad";
    strengths: string[];
    concerns: string[];
    blockers: string[];
  };
};

export type EvaluatedRunSampleSummary = {
  totalSamples: number;
  coveredCaseIds: string[];
  missingCaseIds: string[];
  runTypeCounts: Record<ResearchRunType, number>;
};

export type EvaluationReportSummary = {
  totalCases: number;
  passedCases: number;
  failedCaseIds: string[];
  metricFailures: {
    communityCount: number;
    supportEvidenceCount: number;
    trustWeightedSourceDiversity: number;
    contradictionCount: number;
    leakedAuthClaimCount: number;
    placeholderCount: number;
  };
  gateStatus: {
    trust: boolean;
    coverage: boolean;
    contradiction: boolean;
  };
  blockerIds: ShipBlockerId[];
};

export type EvaluationHarnessReport = {
  projectId: string;
  searchContract: {
    version: string;
    measuredMetrics: SearchEvalMetricId[];
    proxyBanCount: number;
    guardrailCount: number;
    domainShiftedCaseCount: number;
    heldOutCaseCount: number;
    sourceCompetitionCaseCount: number;
    coverageFloorCaseCount: number;
    conditionalContradictionCaseCount: number;
  };
  summary: EvaluationReportSummary;
  evaluatedSamples: EvaluatedRunSampleSummary;
  results: EvaluationCaseResult[];
};

export { summarizeSearchSignals };

export const DEFAULT_EVALUATION_CASES: EvaluationCase[] = [
  {
    id: "react-rsc-vs-spa",
    title: "React Server Components vs SPA — 실전 도입 후회",
    runType: "comparison_tradeoff_analysis",
    query: [
      "React Server Components vs SPA",
      "목표: 결정",
      "대상: 팀",
      "비교: 장단점, 운영 복잡도"
    ].join("\n"),
    tags: ["comparative", "broad-technical", "domain-shifted", "korean-english-mixed"],
    expected: {
      communityCount: { min: 3, max: 6 },
      contradictionCount: { max: 0 },
      leakedAuthClaimCount: { max: 0 },
      placeholderCount: { max: 0 }
    }
  },
  {
    id: "typescript-monolith-vs-microservices",
    title: "TypeScript monolith vs microservices — 팀 생산성 판단",
    runType: "comparison_tradeoff_analysis",
    query: [
      "TypeScript monolith vs microservices",
      "목표: 결정",
      "대상: 팀",
      "비교: 장단점, 운영 복잡도"
    ].join("\n"),
    tags: ["comparative", "broad-technical", "domain-shifted", "korean-english-mixed"],
    expected: {
      communityCount: { min: 4, max: 6 },
      contradictionCount: { max: 0 },
      leakedAuthClaimCount: { max: 0 },
      placeholderCount: { max: 0 }
    }
  },
  {
    id: "rust-vs-go",
    title: "Rust vs Go for systems programming — 팀 도입 결정",
    runType: "comparison_tradeoff_analysis",
    query: [
      "Rust vs Go for systems programming",
      "목표: 결정",
      "대상: 팀",
      "비교: 장단점, 운영 복잡도"
    ].join("\n"),
    tags: ["comparative", "broad-technical", "korean-english-mixed"],
    expected: {
      communityCount: { min: 8, max: 12 },
      contradictionCount: { max: 1 },
      leakedAuthClaimCount: { max: 0 },
      placeholderCount: { max: 0 }
    }
  },
  {
    id: "ai-memory-vs-prompt-stuffing",
    title: "AI agent memory vs prompt stuffing — 구조 선택",
    runType: "comparison_tradeoff_analysis",
    query: [
      "AI agent memory vs prompt stuffing",
      "목표: 결정",
      "대상: 팀",
      "비교: 장단점, 운영 복잡도"
    ].join("\n"),
    tags: ["comparative", "broad-technical", "domain-shifted", "korean-english-mixed", "ai"],
    expected: {
      communityCount: { min: 1, max: 3 },
      contradictionCount: { max: 0 },
      leakedAuthClaimCount: { max: 0 },
      placeholderCount: { max: 0 }
    }
  }
];

export const HELD_OUT_DEEP_TOPIC_EVALUATION_CASES: EvaluationCase[] = [
  {
    id: "postgres-rls-vs-app-authorization",
    title: "Postgres RLS vs app authorization — B2B SaaS access control",
    runType: "comparison_tradeoff_analysis",
    query: [
      "Postgres RLS vs app authorization",
      "goal: decision",
      "target: B2B SaaS access control",
      "comparison: tradeoffs, tenant isolation, operational complexity"
    ].join("\n"),
    tags: ["comparative", "deep-topic", "domain-shifted", "english-only", "held-out"],
    expected: {
      communityCount: { max: 0 },
      supportEvidenceCount: { min: 2 },
      trustWeightedSourceDiversity: { min: 4 },
      contradictionCount: { max: 0 },
      leakedAuthClaimCount: { max: 0 },
      placeholderCount: { max: 0 }
    }
  },
  {
    id: "otel-vs-vendor-apm",
    title: "OpenTelemetry vs vendor APM — platform observability choice",
    runType: "comparison_tradeoff_analysis",
    query: [
      "OpenTelemetry vs vendor APM",
      "goal: decision",
      "target: platform observability",
      "comparison: tradeoffs, lock-in, operational complexity"
    ].join("\n"),
    tags: ["comparative", "deep-topic", "domain-shifted", "korean-english-mixed", "held-out"],
    expected: {
      communityCount: { max: 0 },
      supportEvidenceCount: { min: 2 },
      trustWeightedSourceDiversity: { min: 4 },
      contradictionCount: { max: 0 },
      leakedAuthClaimCount: { max: 0 },
      placeholderCount: { max: 0 }
    }
  }
];

export const AVAILABLE_EVALUATION_CASES: EvaluationCase[] = [
  ...DEFAULT_EVALUATION_CASES,
  ...HELD_OUT_DEEP_TOPIC_EVALUATION_CASES
];

export const DEFAULT_EVALUATED_RUN_SAMPLES: EvaluatedRunSample[] = [
  {
    id: "sample-react-rsc-vs-spa",
    caseId: "react-rsc-vs-spa",
    runType: "comparison_tradeoff_analysis",
    judgedAt: "2026-04-22T00:00:00.000Z",
    basis: "manual_review",
    summary: {
      overall: "good",
      strengths: [
        "placeholder/auth leak 없이 comparative evidence를 회수한다",
        "off-topic community noise가 과거 대비 줄어들었다"
      ],
      concerns: ["contradiction yield가 0으로 보수적이다"],
      blockers: []
    }
  },
  {
    id: "sample-typescript-monolith-vs-microservices",
    caseId: "typescript-monolith-vs-microservices",
    runType: "comparison_tradeoff_analysis",
    judgedAt: "2026-04-22T00:00:00.000Z",
    basis: "manual_review",
    summary: {
      overall: "good",
      strengths: [
        "domain-shifted comparative query의 recall을 회복했다",
        "broad TypeScript noise가 이전보다 줄었다"
      ],
      concerns: ["architecture 일반론이 일부 남을 수 있다"],
      blockers: []
    }
  },
  {
    id: "sample-rust-vs-go",
    caseId: "rust-vs-go",
    runType: "comparison_tradeoff_analysis",
    judgedAt: "2026-04-22T00:00:00.000Z",
    basis: "manual_review",
    summary: {
      overall: "good",
      strengths: [
        "community signal 양이 충분하고 placeholder/auth leak이 없다",
        "systems programming comparative query에서 안정적이다"
      ],
      concerns: ["contradiction yield는 query에 따라 0 또는 1로 흔들릴 수 있다"],
      blockers: []
    }
  },
  {
    id: "sample-ai-memory-vs-prompt-stuffing",
    caseId: "ai-memory-vs-prompt-stuffing",
    runType: "comparison_tradeoff_analysis",
    judgedAt: "2026-04-22T00:00:00.000Z",
    basis: "manual_review",
    summary: {
      overall: "mixed",
      strengths: [
        "broad AI noise를 크게 줄이면서 relevant signal을 일부 회수한다"
      ],
      concerns: [
        "coverage floor가 낮아 recall 민감도가 높다",
        "comparative evidence diversity가 다른 cases보다 약하다"
      ],
      blockers: []
    }
  },
  {
    id: "sample-postgres-rls-vs-app-authorization",
    caseId: "postgres-rls-vs-app-authorization",
    runType: "comparison_tradeoff_analysis",
    judgedAt: "2026-04-24T00:00:00.000Z",
    basis: "manual_review",
    summary: {
      overall: "mixed",
      strengths: [
        "enterprise auth/db comparative query에서 community noise 없이 official docs evidence를 회수한다"
      ],
      concerns: [
        "counterevidence branch는 아직 얕고 decisive evidence position을 더 앞당길 여지가 있다"
      ],
      blockers: []
    }
  },
  {
    id: "sample-otel-vs-vendor-apm",
    caseId: "otel-vs-vendor-apm",
    runType: "comparison_tradeoff_analysis",
    judgedAt: "2026-04-24T00:00:00.000Z",
    basis: "manual_review",
    summary: {
      overall: "good",
      strengths: [
        "observability comparative query에서 community noise 없이 official OpenTelemetry docs를 회수한다"
      ],
      concerns: [
        "vendor-specific decisive evidence branch는 아직 더 보강될 여지가 있다"
      ],
      blockers: []
    }
  }
];

export function summarizeEvaluationRun(record: RunRecord): EvaluationSummary {
  const communityArtifacts = record.artifacts.filter(
    (artifact) => artifact.adapter === "community-search-json"
  );
  const searchSignals = summarizeSearchSignals(record);
  const leakedAuthClaimCount = record.claims.filter((claim) => {
    const text = claim.text.toLowerCase();
    return (
      claim.topicKey === "required" ||
      claim.topicKey === "code" ||
      text.includes("authentication is required") ||
      text.includes("\"code\":401")
    );
  }).length;
  const placeholderCount = communityArtifacts.filter((artifact) =>
    /hn\.algolia\.com\/search|www\.reddit\.com\/search\.json|s\.jina\.ai/i.test(
      artifact.title
    )
  ).length;

  return {
    runId: record.run.id,
    title: record.run.title,
    communityCount: communityArtifacts.length,
    supportEvidenceCount: searchSignals.supportEvidenceCount,
    counterevidenceCount: searchSignals.counterevidenceCount,
    trustWeightedSourceDiversity: searchSignals.trustWeightedSourceDiversity,
    decisiveEvidencePosition: searchSignals.decisiveEvidencePosition,
    contradictionCount: record.contradictions.length,
    leakedAuthClaimCount,
    placeholderCount,
    runAnchors: Array.from(
      new Set(
        record.claims
          .map((claim) => claim.topicKey)
          .filter((topicKey): topicKey is string => typeof topicKey === "string" && topicKey.length > 0)
      )
    ).slice(0, 16),
    communityTitles: communityArtifacts.map((artifact) => artifact.title)
  };
}

export function evaluateSummary(
  summary: EvaluationSummary,
  expected: EvaluationCase["expected"]
): EvaluationResult {
  const failures: string[] = [];
  assertBudget("communityCount", summary.communityCount, expected.communityCount, failures);
  if (expected.supportEvidenceCount) {
    assertBudget(
      "supportEvidenceCount",
      summary.supportEvidenceCount,
      expected.supportEvidenceCount,
      failures
    );
  }
  if (expected.trustWeightedSourceDiversity) {
    assertBudget(
      "trustWeightedSourceDiversity",
      summary.trustWeightedSourceDiversity,
      expected.trustWeightedSourceDiversity,
      failures
    );
  }
  assertBudget(
    "contradictionCount",
    summary.contradictionCount,
    expected.contradictionCount,
    failures
  );
  assertBudget(
    "leakedAuthClaimCount",
    summary.leakedAuthClaimCount,
    expected.leakedAuthClaimCount,
    failures
  );
  assertBudget(
    "placeholderCount",
    summary.placeholderCount,
    expected.placeholderCount,
    failures
  );
  return {
    pass: failures.length === 0,
    failures
  };
}

export function summarizeEvaluationResults(
  results: EvaluationCaseResult[]
): EvaluationReportSummary {
  const failedCaseIds: string[] = [];
  const metricFailures = {
    communityCount: 0,
    supportEvidenceCount: 0,
    trustWeightedSourceDiversity: 0,
    contradictionCount: 0,
    leakedAuthClaimCount: 0,
    placeholderCount: 0
  };

  for (const result of results) {
    if (!result.pass) {
      failedCaseIds.push(result.id);
    }
    for (const failure of result.failures) {
      if (failure.startsWith("communityCount ")) {
        metricFailures.communityCount += 1;
      } else if (failure.startsWith("supportEvidenceCount ")) {
        metricFailures.supportEvidenceCount += 1;
      } else if (failure.startsWith("trustWeightedSourceDiversity ")) {
        metricFailures.trustWeightedSourceDiversity += 1;
      } else if (failure.startsWith("contradictionCount ")) {
        metricFailures.contradictionCount += 1;
      } else if (failure.startsWith("leakedAuthClaimCount ")) {
        metricFailures.leakedAuthClaimCount += 1;
      } else if (failure.startsWith("placeholderCount ")) {
        metricFailures.placeholderCount += 1;
      }
    }
  }

  return {
    totalCases: results.length,
    passedCases: results.length - failedCaseIds.length,
    failedCaseIds,
    metricFailures,
    gateStatus: {
      trust:
        metricFailures.leakedAuthClaimCount === 0 &&
        metricFailures.placeholderCount === 0,
      coverage:
        metricFailures.communityCount === 0 &&
        metricFailures.supportEvidenceCount === 0 &&
        metricFailures.trustWeightedSourceDiversity === 0,
      contradiction: metricFailures.contradictionCount === 0
    },
    blockerIds: []
  };
}

export function evaluateBaselineGuardrails(
  input: BaselineGuardrailInput
): BaselineGuardrailResult {
  const blockerIds: ShipBlockerId[] = [];

  if (input.adaptivePolicyOn.contradictionCount < input.freshNoMemory.contradictionCount) {
    blockerIds.push("contradiction_exposure_regression");
  }
  if (input.adaptivePolicyOn.communityCount < input.freshNoMemory.communityCount) {
    blockerIds.push("source_diversity_floor_collapse");
  }
  if (input.freshnessMinimumViolated) {
    blockerIds.push("freshness_minimum_violation");
  }
  if (input.provenanceCompletenessRegressed) {
    blockerIds.push("provenance_completeness_regression");
  }
  if (input.crossContextContamination) {
    blockerIds.push("cross_context_contamination");
  }

  return {
    pass: blockerIds.length === 0,
    blockerIds,
    rollbackTriggered: blockerIds.length > 0,
    comparisonRule: BASELINE_HARNESS_RULE.comparisonRule,
    failRule: BASELINE_HARNESS_RULE.failRule,
    rollbackTrigger: BASELINE_HARNESS_RULE.rollbackTrigger
  };
}

export function listNonCompensatoryShipBlockers(): ShipBlockerId[] {
  return Object.keys(NON_COMPENSATORY_SHIP_BLOCKERS) as ShipBlockerId[];
}

export function summarizeEvaluatedRunSamples(
  cases: EvaluationCase[],
  samples: EvaluatedRunSample[]
): EvaluatedRunSampleSummary {
  const coveredCaseIds = Array.from(new Set(samples.map((sample) => sample.caseId)));
  const missingCaseIds = cases
    .map((entry) => entry.id)
    .filter((caseId) => !coveredCaseIds.includes(caseId));

  const runTypeCounts: Record<ResearchRunType, number> = {
    exploratory_scan: 0,
    comparison_tradeoff_analysis: 0,
    longitudinal_watch: 0,
    contradiction_resolution: 0,
    pre_decision_verification: 0
  };

  for (const sample of samples) {
    runTypeCounts[sample.runType] += 1;
  }

  return {
    totalSamples: samples.length,
    coveredCaseIds,
    missingCaseIds,
    runTypeCounts
  };
}

export function renderEvaluationMarkdownReport(report: EvaluationHarnessReport): string {
  const lines: string[] = [
    "# Research Engine Evaluation Report",
    "",
    `- projectId: \`${report.projectId}\``,
    `- totalCases: ${report.summary.totalCases}`,
    `- passedCases: ${report.summary.passedCases}`,
    `- gateStatus: trust=${report.summary.gateStatus.trust}, coverage=${report.summary.gateStatus.coverage}, contradiction=${report.summary.gateStatus.contradiction}`,
    ""
  ];

  if (report.summary.failedCaseIds.length > 0) {
    lines.push("## Failed Cases", "");
    for (const caseId of report.summary.failedCaseIds) {
      lines.push(`- ${caseId}`);
    }
      lines.push("");
  }

  lines.push(
    "## Search Eval Contract",
    "",
    `- version: \`${report.searchContract.version}\``,
    `- measuredMetrics: ${report.searchContract.measuredMetrics.join(", ")}`,
    `- proxyBanCount: ${report.searchContract.proxyBanCount}`,
    `- guardrailCount: ${report.searchContract.guardrailCount}`,
    `- domainShiftedCaseCount: ${report.searchContract.domainShiftedCaseCount}`,
    `- heldOutCaseCount: ${report.searchContract.heldOutCaseCount}`,
    `- sourceCompetitionCaseCount: ${report.searchContract.sourceCompetitionCaseCount}`,
    `- coverageFloorCaseCount: ${report.searchContract.coverageFloorCaseCount}`,
    `- conditionalContradictionCaseCount: ${report.searchContract.conditionalContradictionCaseCount}`,
    ""
  );

  lines.push(
    "## Evaluated Run Samples",
    "",
    `- totalSamples: ${report.evaluatedSamples.totalSamples}`,
    `- coveredCaseIds: ${report.evaluatedSamples.coveredCaseIds.join(", ") || "(none)"}`,
    `- missingCaseIds: ${report.evaluatedSamples.missingCaseIds.join(", ") || "(none)"}`,
    ""
  );

  lines.push("## Case Results", "");
  for (const result of report.results) {
    lines.push(`### ${result.id}`, "");
    lines.push(`- runType: ${result.runType}`);
    lines.push(`- pass: ${result.pass}`);
    lines.push(`- communityCount: ${result.summary.communityCount}`);
    lines.push(`- supportEvidenceCount: ${result.summary.supportEvidenceCount}`);
    lines.push(
      `- trustWeightedSourceDiversity: ${result.summary.trustWeightedSourceDiversity}`
    );
    lines.push(`- contradictionCount: ${result.summary.contradictionCount}`);
    lines.push(`- leakedAuthClaimCount: ${result.summary.leakedAuthClaimCount}`);
    lines.push(`- placeholderCount: ${result.summary.placeholderCount}`);
    lines.push(`- runId: \`${result.summary.runId}\``);
    lines.push(`- runAnchors: ${result.summary.runAnchors.join(", ") || "(none)"}`);
    lines.push(
      `- communityTitles: ${result.summary.communityTitles.slice(0, 6).join(" | ") || "(none)"}`
    );
    if (result.failures.length > 0) {
      lines.push(`- failures: ${result.failures.join(" ; ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function buildSearchContractSummary(): EvaluationHarnessReport["searchContract"] {
  const domainShiftedSummary = summarizeSearchEvalCases(DOMAIN_SHIFTED_SEARCH_EVAL_CASES);
  const sourceCompetitionSummary = summarizeSearchEvalCases(SOURCE_COMPETITION_SEARCH_EVAL_CASES);
  const coverageFloorSummary = summarizeSearchEvalCases(COVERAGE_FLOOR_SEARCH_EVAL_CASES);
  const conditionalContradictionSummary = summarizeSearchEvalCases(
    CONDITIONAL_CONTRADICTION_SEARCH_EVAL_CASES
  );
  return {
    version: SEARCH_EVAL_CONTRACT_VERSION,
    measuredMetrics: Object.entries(SEARCH_EVAL_METRIC_MATRIX)
      .filter(([, definition]) => definition.measurable)
      .map(([metricId]) => metricId as SearchEvalMetricId),
    proxyBanCount: SEARCH_NON_SIGNAL_PROXY_BAN_LIST.length,
    guardrailCount: SEARCH_POLICY_GUARDRAILS.length,
    domainShiftedCaseCount: domainShiftedSummary.totalCases,
    heldOutCaseCount: domainShiftedSummary.heldOutCases,
    sourceCompetitionCaseCount: sourceCompetitionSummary.totalCases,
    coverageFloorCaseCount: coverageFloorSummary.totalCases,
    conditionalContradictionCaseCount: conditionalContradictionSummary.totalCases
  };
}

function assertBudget(
  label: string,
  value: number,
  budget: EvaluationBudget,
  failures: string[]
): void {
  if (typeof budget.min === "number" && value < budget.min) {
    failures.push(`${label} expected >= ${budget.min}, got ${value}`);
  }
  if (typeof budget.max === "number" && value > budget.max) {
    failures.push(`${label} expected <= ${budget.max}, got ${value}`);
  }
}
