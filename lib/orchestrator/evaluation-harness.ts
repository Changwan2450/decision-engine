import type { RunRecord } from "@/lib/storage/schema";

export type EvaluationBudget = {
  min?: number;
  max?: number;
};

export type EvaluationCase = {
  id: string;
  title: string;
  query: string;
  tags: string[];
  expected: {
    communityCount: EvaluationBudget;
    contradictionCount: EvaluationBudget;
    leakedAuthClaimCount: EvaluationBudget;
    placeholderCount: EvaluationBudget;
  };
};

export type EvaluationSummary = {
  runId: string;
  title: string;
  communityCount: number;
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

export type EvaluationCaseResult = {
  id: string;
  tags: string[];
  summary: EvaluationSummary;
  expected: EvaluationCase["expected"];
  pass: boolean;
  failures: string[];
};

export type EvaluationReportSummary = {
  totalCases: number;
  passedCases: number;
  failedCaseIds: string[];
  metricFailures: {
    communityCount: number;
    contradictionCount: number;
    leakedAuthClaimCount: number;
    placeholderCount: number;
  };
  gateStatus: {
    trust: boolean;
    coverage: boolean;
    contradiction: boolean;
  };
};

export const DEFAULT_EVALUATION_CASES: EvaluationCase[] = [
  {
    id: "react-rsc-vs-spa",
    title: "React Server Components vs SPA — 실전 도입 후회",
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

export function summarizeEvaluationRun(record: RunRecord): EvaluationSummary {
  const communityArtifacts = record.artifacts.filter(
    (artifact) => artifact.adapter === "community-search-json"
  );
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
      coverage: metricFailures.communityCount === 0,
      contradiction: metricFailures.contradictionCount === 0
    }
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
