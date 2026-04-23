import { describe, expect, it } from "vitest";
import {
  AVAILABLE_EVALUATION_CASES,
  DEFAULT_EVALUATED_RUN_SAMPLES,
  DEFAULT_EVALUATION_CASES,
  HELD_OUT_DEEP_TOPIC_EVALUATION_CASES,
  evaluateBaselineGuardrails,
  evaluateSummary,
  listNonCompensatoryShipBlockers,
  renderEvaluationMarkdownReport,
  summarizeSearchSignals,
  summarizeEvaluatedRunSamples,
  summarizeEvaluationResults,
  summarizeEvaluationRun
} from "@/lib/orchestrator/evaluation-harness";
import type { RunRecord } from "@/lib/storage/schema";

describe("evaluation-harness", () => {
  it("summarizes run records into stable regression metrics", () => {
    const record = {
      run: {
        id: "run-1",
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
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z"
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
          id: "artifact-1",
          adapter: "community-search-json",
          sourceType: "community",
          title: "React Server Components: Do They Really Improve Performance?",
          url: "https://example.com/rsc",
          canonicalUrl: "https://example.com/rsc",
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
        }
      ],
      claims: [
        {
          id: "claim-1",
          artifactId: "artifact-1",
          text: "React Server Components improve some rendering paths",
          topicKey: "server-components",
          stance: "support",
          citationIds: []
        }
      ],
      citations: [],
      contradictions: [],
      evidenceSummary: null,
      advisory: null
    } satisfies RunRecord;

    expect(summarizeEvaluationRun(record)).toEqual({
      runId: "run-1",
      title: "React Server Components vs SPA — 실전 도입 후회",
      communityCount: 1,
      supportEvidenceCount: 1,
      counterevidenceCount: 0,
      trustWeightedSourceDiversity: 1,
      decisiveEvidencePosition: 1,
      contradictionCount: 0,
      leakedAuthClaimCount: 0,
      placeholderCount: 0,
      runAnchors: ["server-components"],
      communityTitles: ["React Server Components: Do They Really Improve Performance?"]
    });
  });

  it("fails when metrics exceed the expected noise budget", () => {
    const result = evaluateSummary(
      {
        runId: "run-1",
        title: "t",
        communityCount: 7,
        supportEvidenceCount: 0,
        counterevidenceCount: 0,
        trustWeightedSourceDiversity: 0,
        decisiveEvidencePosition: null,
        contradictionCount: 2,
        leakedAuthClaimCount: 1,
        placeholderCount: 1,
        runAnchors: [],
        communityTitles: []
      },
      {
        communityCount: { min: 3, max: 6 },
        contradictionCount: { max: 0 },
        leakedAuthClaimCount: { max: 0 },
        placeholderCount: { max: 0 }
      }
    );

    expect(result.pass).toBe(false);
    expect(result.failures).toEqual([
      "communityCount expected <= 6, got 7",
      "contradictionCount expected <= 0, got 2",
      "leakedAuthClaimCount expected <= 0, got 1",
      "placeholderCount expected <= 0, got 1"
    ]);
  });

  it("ships a fixed four-case generalization regression set", () => {
    expect(DEFAULT_EVALUATION_CASES.map((entry) => entry.id)).toEqual([
      "react-rsc-vs-spa",
      "typescript-monolith-vs-microservices",
      "rust-vs-go",
      "ai-memory-vs-prompt-stuffing"
    ]);
    expect(DEFAULT_EVALUATION_CASES.every((entry) => entry.tags.includes("comparative"))).toBe(true);
    expect(
      DEFAULT_EVALUATION_CASES.every(
        (entry) => entry.runType === "comparison_tradeoff_analysis"
      )
    ).toBe(true);
  });

  it("summarizes case results into adoption-friendly gate status", () => {
    expect(
      summarizeEvaluationResults([
        {
          id: "react-rsc-vs-spa",
          runType: "comparison_tradeoff_analysis",
          tags: ["comparative"],
          summary: {
            runId: "run-1",
            title: "react",
            communityCount: 5,
            supportEvidenceCount: 2,
            counterevidenceCount: 0,
            trustWeightedSourceDiversity: 4,
            decisiveEvidencePosition: 1,
            contradictionCount: 0,
            leakedAuthClaimCount: 0,
            placeholderCount: 0,
            runAnchors: [],
            communityTitles: []
          },
          expected: {
            communityCount: { min: 3, max: 6 },
            contradictionCount: { max: 0 },
            leakedAuthClaimCount: { max: 0 },
            placeholderCount: { max: 0 }
          },
          pass: true,
          failures: []
        },
        {
          id: "ai-memory-vs-prompt-stuffing",
          runType: "comparison_tradeoff_analysis",
          tags: ["comparative", "ai"],
          summary: {
            runId: "run-2",
            title: "ai",
            communityCount: 0,
            supportEvidenceCount: 0,
            counterevidenceCount: 0,
            trustWeightedSourceDiversity: 0,
            decisiveEvidencePosition: null,
            contradictionCount: 1,
            leakedAuthClaimCount: 0,
            placeholderCount: 1,
            runAnchors: [],
            communityTitles: []
          },
          expected: {
            communityCount: { min: 1, max: 3 },
            contradictionCount: { max: 0 },
            leakedAuthClaimCount: { max: 0 },
            placeholderCount: { max: 0 }
          },
          pass: false,
          failures: [
            "communityCount expected >= 1, got 0",
            "contradictionCount expected <= 0, got 1",
            "placeholderCount expected <= 0, got 1"
          ]
        }
      ])
    ).toEqual({
      totalCases: 2,
      passedCases: 1,
      failedCaseIds: ["ai-memory-vs-prompt-stuffing"],
      metricFailures: {
        communityCount: 1,
        supportEvidenceCount: 0,
        trustWeightedSourceDiversity: 0,
        contradictionCount: 1,
        leakedAuthClaimCount: 0,
        placeholderCount: 1
      },
      gateStatus: {
        trust: false,
        coverage: false,
        contradiction: false
      },
      blockerIds: []
    });
  });

  it("tracks manual evaluated run samples as bootstrap evidence for the contract", () => {
    expect(HELD_OUT_DEEP_TOPIC_EVALUATION_CASES.map((entry) => entry.id)).toEqual([
      "postgres-rls-vs-app-authorization"
    ]);
    expect(AVAILABLE_EVALUATION_CASES.map((entry) => entry.id)).toEqual([
      "react-rsc-vs-spa",
      "typescript-monolith-vs-microservices",
      "rust-vs-go",
      "ai-memory-vs-prompt-stuffing",
      "postgres-rls-vs-app-authorization"
    ]);
    expect(DEFAULT_EVALUATED_RUN_SAMPLES.map((entry) => entry.caseId)).toEqual([
      "react-rsc-vs-spa",
      "typescript-monolith-vs-microservices",
      "rust-vs-go",
      "ai-memory-vs-prompt-stuffing",
      "postgres-rls-vs-app-authorization"
    ]);

    expect(
      summarizeEvaluatedRunSamples(AVAILABLE_EVALUATION_CASES, DEFAULT_EVALUATED_RUN_SAMPLES)
    ).toEqual({
      totalSamples: 5,
      coveredCaseIds: [
        "react-rsc-vs-spa",
        "typescript-monolith-vs-microservices",
        "rust-vs-go",
        "ai-memory-vs-prompt-stuffing",
        "postgres-rls-vs-app-authorization"
      ],
      missingCaseIds: [],
      runTypeCounts: {
        exploratory_scan: 0,
        comparison_tradeoff_analysis: 5,
        longitudinal_watch: 0,
        contradiction_resolution: 0,
        pre_decision_verification: 0
      }
    });
  });

  it("summarizes measurable search signals for retrieval policy evaluation", () => {
    const record = {
      run: {
        id: "run-1",
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
        createdAt: "2026-04-21T00:00:00.000Z",
        updatedAt: "2026-04-21T00:00:00.000Z"
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
          id: "artifact-1",
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
          id: "artifact-2",
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
        }
      ],
      claims: [
        {
          id: "claim-1",
          artifactId: "artifact-1",
          text: "RSC can reduce client bundle size in some paths",
          topicKey: "server-components",
          stance: "support",
          citationIds: ["citation-1"]
        },
        {
          id: "claim-2",
          artifactId: "artifact-2",
          text: "React documents a server/client split model",
          topicKey: "server-components",
          stance: "oppose",
          citationIds: ["citation-2"]
        }
      ],
      citations: [
        {
          id: "citation-1",
          artifactId: "artifact-1",
          url: "https://example.com/community",
          title: "App Router (RSC) vs SPA",
          priority: "community"
        },
        {
          id: "citation-2",
          artifactId: "artifact-2",
          url: "https://react.dev/rsc",
          title: "React Server Components docs",
          priority: "official"
        }
      ],
      contradictions: [
        {
          id: "contradiction-1",
          claimIds: ["claim-1", "claim-2"],
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
      supportEvidenceCount: 1,
      counterevidenceCount: 1,
      contradictionCount: 1,
      falseContradictionRate: 0,
      trustWeightedSourceDiversity: 4,
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

  it("enforces non-compensatory blockers in baseline comparison", () => {
    expect(
      evaluateBaselineGuardrails({
        freshNoMemory: {
          runId: "fresh",
          title: "comparison",
          communityCount: 5,
          supportEvidenceCount: 2,
          counterevidenceCount: 1,
          trustWeightedSourceDiversity: 4,
          decisiveEvidencePosition: 1,
          contradictionCount: 1,
          leakedAuthClaimCount: 0,
          placeholderCount: 0,
          runAnchors: [],
          communityTitles: []
        },
        adaptivePolicyOn: {
          runId: "adaptive",
          title: "comparison",
          communityCount: 4,
          supportEvidenceCount: 2,
          counterevidenceCount: 0,
          trustWeightedSourceDiversity: 4,
          decisiveEvidencePosition: 1,
          contradictionCount: 0,
          leakedAuthClaimCount: 0,
          placeholderCount: 0,
          runAnchors: [],
          communityTitles: []
        },
        freshnessMinimumViolated: true,
        provenanceCompletenessRegressed: true
      })
    ).toEqual({
      pass: false,
      blockerIds: [
        "contradiction_exposure_regression",
        "source_diversity_floor_collapse",
        "freshness_minimum_violation",
        "provenance_completeness_regression"
      ],
      rollbackTriggered: true,
      comparisonRule:
        "adaptive_policy_on must beat fresh_no_memory on allowed quality metrics",
      failRule:
        "any non-compensatory blocker breach fails regardless of packaging/helpfulness gains",
      rollbackTrigger: "adaptive policy loses to fresh_no_memory on guarded metrics"
    });
  });

  it("keeps ship blockers explicit for enforcement and rollback", () => {
    expect(listNonCompensatoryShipBlockers()).toEqual([
      "contradiction_exposure_regression",
      "source_diversity_floor_collapse",
      "freshness_minimum_violation",
      "provenance_completeness_regression",
      "cross_context_contamination"
    ]);
  });

  it("renders a markdown proof report for operator-visible evidence", () => {
    const markdown = renderEvaluationMarkdownReport({
      projectId: "project-1",
      searchContract: {
        version: "2026-04-22.v1",
        measuredMetrics: [
          "support_recall_floor",
          "counterevidence_recall_floor",
          "false_contradiction_rate",
          "trust_weighted_source_diversity",
          "decisive_evidence_position"
        ],
        proxyBanCount: 5,
        guardrailCount: 4,
        domainShiftedCaseCount: 6,
        heldOutCaseCount: 4,
        sourceCompetitionCaseCount: 4,
        coverageFloorCaseCount: 3,
        conditionalContradictionCaseCount: 3
      },
      summary: {
        totalCases: 1,
        passedCases: 1,
        failedCaseIds: [],
        metricFailures: {
          communityCount: 0,
          supportEvidenceCount: 0,
          trustWeightedSourceDiversity: 0,
          contradictionCount: 0,
          leakedAuthClaimCount: 0,
          placeholderCount: 0
        },
        gateStatus: {
          trust: true,
          coverage: true,
          contradiction: true
        },
        blockerIds: []
      },
      evaluatedSamples: {
        totalSamples: 1,
        coveredCaseIds: ["react-rsc-vs-spa"],
        missingCaseIds: [],
        runTypeCounts: {
          exploratory_scan: 0,
          comparison_tradeoff_analysis: 1,
          longitudinal_watch: 0,
          contradiction_resolution: 0,
          pre_decision_verification: 0
        }
      },
      results: [
        {
          id: "react-rsc-vs-spa",
          runType: "comparison_tradeoff_analysis",
          tags: ["comparative"],
          summary: {
            runId: "run-1",
            title: "React Server Components vs SPA",
            communityCount: 5,
            supportEvidenceCount: 2,
            counterevidenceCount: 0,
            trustWeightedSourceDiversity: 4,
            decisiveEvidencePosition: 1,
            contradictionCount: 0,
            leakedAuthClaimCount: 0,
            placeholderCount: 0,
            runAnchors: ["server-components"],
            communityTitles: ["App Router (RSC) vs SPA"]
          },
          expected: {
            communityCount: { min: 3, max: 6 },
            contradictionCount: { max: 0 },
            leakedAuthClaimCount: { max: 0 },
            placeholderCount: { max: 0 }
          },
          pass: true,
          failures: []
        }
      ]
    });

    expect(markdown).toContain("# Research Engine Evaluation Report");
    expect(markdown).toContain("projectId: `project-1`");
    expect(markdown).toContain("## Search Eval Contract");
    expect(markdown).toContain("support_recall_floor");
    expect(markdown).toContain("domainShiftedCaseCount: 6");
    expect(markdown).toContain("sourceCompetitionCaseCount: 4");
    expect(markdown).toContain("coverageFloorCaseCount: 3");
    expect(markdown).toContain("conditionalContradictionCaseCount: 3");
    expect(markdown).toContain("### react-rsc-vs-spa");
    expect(markdown).toContain("App Router (RSC) vs SPA");
  });
});
