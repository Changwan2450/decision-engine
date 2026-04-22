import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_EVAL_CASES,
  DOMAIN_SHIFTED_SEARCH_EVAL_CASES,
  SEARCH_EVAL_CONTRACT_VERSION,
  SEARCH_EVAL_METRIC_MATRIX,
  SEARCH_NON_SIGNAL_PROXY_BAN_LIST,
  SEARCH_POLICY_GUARDRAILS,
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
