import { describe, expect, it } from "vitest";
import {
  CONDITIONAL_CONTRADICTION_REQUIREMENTS,
  CONDITIONAL_CONTRADICTION_SEARCH_EVAL_CASES,
  COVERAGE_FLOOR_REQUIREMENTS,
  COVERAGE_FLOOR_SEARCH_EVAL_CASES,
  DEFAULT_SEARCH_EVAL_CASES,
  DOMAIN_SHIFTED_SEARCH_EVAL_CASES,
  RETRIEVAL_POLICY_PROFILES,
  SEARCH_EVAL_CONTRACT_VERSION,
  SEARCH_EVAL_METRIC_MATRIX,
  SEARCH_NON_SIGNAL_PROXY_BAN_LIST,
  SEARCH_POLICY_GUARDRAILS,
  SOURCE_COMPETITION_SEARCH_EVAL_CASES,
  summarizeSearchEvalCases,
  summarizeSearchSignals
} from "@/lib/orchestrator/search-eval-contract";
import type { RunRecord } from "@/lib/storage/schema";

describe("search-eval-contract", () => {
  it("ships a versioned search eval contract with explicit measurable metrics", () => {
    expect(SEARCH_EVAL_CONTRACT_VERSION).toBe("2026-04-22.v1");
    expect(Object.keys(SEARCH_EVAL_METRIC_MATRIX)).toEqual([
      "support_recall_floor",
      "counterevidence_recall_floor",
      "false_contradiction_rate",
      "trust_weighted_source_diversity",
      "decisive_evidence_position",
      "manual_rescue_rate",
      "appropriate_abstention_rate"
    ]);
  });

  it("keeps explicit non-signal bans and retrieval policy guardrails", () => {
    expect(SEARCH_NON_SIGNAL_PROXY_BAN_LIST).toEqual(
      expect.arrayContaining([
        "raw_result_count",
        "fanout_depth_alone",
        "latency_without_evidence_gain",
        "click_through_rate",
        "operator_satisfaction_alone"
      ])
    );
    expect(SEARCH_POLICY_GUARDRAILS).toEqual(
      expect.arrayContaining([
        "retrieval must be budgeted",
        "coverage is a floor objective, not the product thesis",
        "contradiction retrieval is conditional, not global",
        "stopping and abstention are part of search quality"
      ])
    );
  });

  it("classifies search cases around retrieval-policy bottlenecks", () => {
    expect(DEFAULT_SEARCH_EVAL_CASES.map((entry) => entry.id)).toEqual([
      "react-rsc-vs-spa",
      "typescript-monolith-vs-microservices",
      "rust-vs-go",
      "ai-memory-vs-prompt-stuffing"
    ]);
    expect(DEFAULT_SEARCH_EVAL_CASES.map((entry) => entry.primaryBottleneck)).toEqual([
      "domain_shifted_recall",
      "domain_shifted_recall",
      "source_competition_ranking",
      "conditional_contradiction_retrieval"
    ]);
  });

  it("ships an expanded domain-shifted recall pack instead of relying on the fixed 4-case set", () => {
    expect(DOMAIN_SHIFTED_SEARCH_EVAL_CASES.map((entry) => entry.id)).toEqual([
      "react-rsc-vs-spa",
      "typescript-monolith-vs-microservices",
      "nextjs-app-router-vs-spa",
      "rag-vs-long-context-korean",
      "postgres-rls-vs-app-authorization",
      "otel-vs-vendor-apm"
    ]);
    expect(
      DOMAIN_SHIFTED_SEARCH_EVAL_CASES.every(
        (entry) => entry.primaryBottleneck === "domain_shifted_recall"
      )
    ).toBe(true);
    expect(
      summarizeSearchEvalCases(DOMAIN_SHIFTED_SEARCH_EVAL_CASES)
    ).toEqual({
      totalCases: 6,
      heldOutCases: 4,
      bottleneckCounts: {
        domain_shifted_recall: 6,
        source_competition_ranking: 0,
        coverage_floor: 0,
        conditional_contradiction_retrieval: 0
      },
      runTypeCounts: {
        comparison_tradeoff_analysis: 6
      },
      languageMixCounts: {
        korean_english_mixed: 4,
        english_only: 2
      }
    });
  });

  it("defines budgeted retrieval policy profiles instead of vague search intelligence", () => {
    expect(RETRIEVAL_POLICY_PROFILES.comparison_tradeoff_analysis).toEqual({
      maxSourceBranches: 4,
      maxQueryExpansionsPerBranch: 2,
      contradictionMode: "conditional",
      stopRule: "stop when decisive evidence exists across >=2 trust classes or budget is exhausted",
      abstainRule: "abstain when decisive evidence is absent after branch budget is exhausted"
    });
    expect(RETRIEVAL_POLICY_PROFILES.pre_decision_verification).toEqual({
      maxSourceBranches: 5,
      maxQueryExpansionsPerBranch: 2,
      contradictionMode: "required",
      stopRule: "stop only after freshness and counterevidence checks both succeed or budget is exhausted",
      abstainRule: "abstain when freshness/provenance minimum is unmet at budget boundary"
    });
  });

  it("ships a source competition pack for ranking and decisive-evidence position", () => {
    expect(SOURCE_COMPETITION_SEARCH_EVAL_CASES.map((entry) => entry.id)).toEqual([
      "rust-vs-go",
      "postgres-rls-vs-app-authorization",
      "otel-vs-vendor-apm",
      "react-rsc-vs-spa"
    ]);
    expect(
      summarizeSearchEvalCases(SOURCE_COMPETITION_SEARCH_EVAL_CASES)
    ).toEqual({
      totalCases: 4,
      heldOutCases: 3,
      bottleneckCounts: {
        domain_shifted_recall: 0,
        source_competition_ranking: 4,
        coverage_floor: 0,
        conditional_contradiction_retrieval: 0
      },
      runTypeCounts: {
        comparison_tradeoff_analysis: 4
      },
      languageMixCounts: {
        korean_english_mixed: 3,
        english_only: 1
      }
    });
  });

  it("treats coverage as a floor objective with a bounded evaluation pack", () => {
    expect(COVERAGE_FLOOR_REQUIREMENTS).toEqual({
      minimumUsableEvidencePerCase: 2,
      minimumTrustClassesPerCase: 2,
      maxPlaceholderOrAuthLeaks: 0,
      maxAllowedCoverageOnlyCases: 3
    });
    expect(COVERAGE_FLOOR_SEARCH_EVAL_CASES.map((entry) => entry.id)).toEqual([
      "ai-memory-vs-prompt-stuffing",
      "react-rsc-vs-spa",
      "rag-vs-long-context-korean"
    ]);
    expect(
      summarizeSearchEvalCases(COVERAGE_FLOOR_SEARCH_EVAL_CASES)
    ).toEqual({
      totalCases: 3,
      heldOutCases: 1,
      bottleneckCounts: {
        domain_shifted_recall: 0,
        source_competition_ranking: 0,
        coverage_floor: 3,
        conditional_contradiction_retrieval: 0
      },
      runTypeCounts: {
        comparison_tradeoff_analysis: 3
      },
      languageMixCounts: {
        korean_english_mixed: 3,
        english_only: 0
      }
    });
  });

  it("treats contradiction retrieval as a conditional mode under trust constraints", () => {
    expect(CONDITIONAL_CONTRADICTION_REQUIREMENTS).toEqual({
      activationRule: "enable only for contradiction-sensitive query types or explicit dispute verification",
      minimumCounterevidencePerCase: 1,
      maxFalseContradictionRate: 0.2,
      requiredTrustClasses: 2
    });
    expect(CONDITIONAL_CONTRADICTION_SEARCH_EVAL_CASES.map((entry) => entry.id)).toEqual([
      "ai-memory-vs-prompt-stuffing",
      "vendor-claim-verification-rsc",
      "policy-memo-rag-vs-finetune"
    ]);
    expect(
      summarizeSearchEvalCases(CONDITIONAL_CONTRADICTION_SEARCH_EVAL_CASES)
    ).toEqual({
      totalCases: 3,
      heldOutCases: 2,
      bottleneckCounts: {
        domain_shifted_recall: 0,
        source_competition_ranking: 0,
        coverage_floor: 0,
        conditional_contradiction_retrieval: 3
      },
      runTypeCounts: {
        comparison_tradeoff_analysis: 3
      },
      languageMixCounts: {
        korean_english_mixed: 2,
        english_only: 1
      }
    });
  });

  it("summarizes measurable search signals without pretending unmeasurable quality", () => {
    const record = {
      run: {
        id: "run-search-1",
        projectId: "project-1",
        title: "React Server Components vs SPA — 실전 도입 후회",
        mode: "standard",
        status: "decided",
        clarificationQuestions: [],
        input: {
          naturalLanguage: "",
          pastedContent: "",
          urls: []
        },
        createdAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z"
      },
      watchContext: null,
      projectOrigin: null,
      normalizedInput: null,
      expansion: null,
      kbContext: null,
      decision: null,
      prdSeed: null,
      artifacts: [
        {
          id: "artifact-community",
          adapter: "community-search-json",
          sourceType: "community",
          title: "App Router (RSC) vs SPA",
          url: "https://example.com/community",
          canonicalUrl: "https://example.com/community",
          snippet: "snippet",
          content: "content",
          sourcePriority: "community",
          metadata: {
            fetcher: "community-search-json",
            fetch_status: "success",
            block_reason: "unknown",
            bypass_level: "none",
            login_required: "false"
          }
        },
        {
          id: "artifact-official",
          adapter: "agent-reach",
          sourceType: "web",
          title: "React Server Components docs",
          url: "https://react.dev/rsc",
          canonicalUrl: "https://react.dev/rsc",
          snippet: "snippet",
          content: "content",
          sourcePriority: "official",
          metadata: {
            fetcher: "agent-reach",
            fetch_status: "success",
            block_reason: "unknown",
            bypass_level: "none",
            login_required: "false"
          }
        },
        {
          id: "artifact-analysis",
          adapter: "agent-reach",
          sourceType: "web",
          title: "Practical RSC tradeoffs",
          url: "https://example.com/analysis",
          canonicalUrl: "https://example.com/analysis",
          snippet: "snippet",
          content: "content",
          sourcePriority: "analysis",
          metadata: {
            fetcher: "agent-reach",
            fetch_status: "success",
            block_reason: "unknown",
            bypass_level: "none",
            login_required: "false"
          }
        }
      ],
      claims: [
        {
          id: "claim-support-1",
          artifactId: "artifact-community",
          text: "RSC can reduce client bundle size in some paths",
          topicKey: "server-components",
          stance: "support",
          citationIds: ["citation-1"]
        },
        {
          id: "claim-support-2",
          artifactId: "artifact-official",
          text: "React documents RSC as a server/client split model",
          topicKey: "server-components",
          stance: "support",
          citationIds: ["citation-2"]
        },
        {
          id: "claim-oppose-1",
          artifactId: "artifact-analysis",
          text: "Operational complexity can outweigh gains for some teams",
          topicKey: "server-components",
          stance: "oppose",
          citationIds: ["citation-3"]
        }
      ],
      citations: [
        {
          id: "citation-1",
          artifactId: "artifact-community",
          url: "https://example.com/community",
          title: "App Router (RSC) vs SPA",
          priority: "community"
        },
        {
          id: "citation-2",
          artifactId: "artifact-official",
          url: "https://react.dev/rsc",
          title: "React Server Components docs",
          priority: "official"
        },
        {
          id: "citation-3",
          artifactId: "artifact-analysis",
          url: "https://example.com/analysis",
          title: "Practical RSC tradeoffs",
          priority: "analysis"
        }
      ],
      contradictions: [
        {
          id: "contradiction-1",
          claimIds: ["claim-support-1", "claim-oppose-1"],
          status: "flagged",
          resolution: "unresolved",
          kind: "mixed",
          tierA: "community",
          tierB: "official"
        }
      ],
      evidenceSummary: null,
      advisory: null
    } satisfies RunRecord;

    expect(summarizeSearchSignals(record)).toEqual({
      supportEvidenceCount: 2,
      counterevidenceCount: 1,
      contradictionCount: 1,
      falseContradictionRate: 0,
      trustWeightedSourceDiversity: 6,
      decisiveEvidencePosition: 1,
      measuredMetrics: [
        "support_recall_floor",
        "counterevidence_recall_floor",
        "false_contradiction_rate",
        "trust_weighted_source_diversity",
        "decisive_evidence_position"
      ],
      unmeasuredMetrics: [
        "manual_rescue_rate",
        "appropriate_abstention_rate"
      ]
    });
  });
});
