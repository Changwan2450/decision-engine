import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVALUATED_RUN_SAMPLES,
  DEFAULT_EVALUATION_CASES,
  evaluateBaselineGuardrails,
  evaluateSummary,
  listNonCompensatoryShipBlockers,
  renderEvaluationMarkdownReport,
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
    expect(DEFAULT_EVALUATED_RUN_SAMPLES.map((entry) => entry.caseId)).toEqual([
      "react-rsc-vs-spa",
      "typescript-monolith-vs-microservices",
      "rust-vs-go",
      "ai-memory-vs-prompt-stuffing"
    ]);

    expect(
      summarizeEvaluatedRunSamples(DEFAULT_EVALUATION_CASES, DEFAULT_EVALUATED_RUN_SAMPLES)
    ).toEqual({
      totalSamples: 4,
      coveredCaseIds: [
        "react-rsc-vs-spa",
        "typescript-monolith-vs-microservices",
        "rust-vs-go",
        "ai-memory-vs-prompt-stuffing"
      ],
      missingCaseIds: [],
      runTypeCounts: {
        exploratory_scan: 0,
        comparison_tradeoff_analysis: 4,
        longitudinal_watch: 0,
        contradiction_resolution: 0,
        pre_decision_verification: 0
      }
    });
  });

  it("enforces non-compensatory blockers in baseline comparison", () => {
    expect(
      evaluateBaselineGuardrails({
        freshNoMemory: {
          runId: "fresh",
          title: "comparison",
          communityCount: 5,
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
      summary: {
        totalCases: 1,
        passedCases: 1,
        failedCaseIds: [],
        metricFailures: {
          communityCount: 0,
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
    expect(markdown).toContain("### react-rsc-vs-spa");
    expect(markdown).toContain("App Router (RSC) vs SPA");
  });
});
