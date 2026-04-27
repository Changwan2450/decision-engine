import { describe, expect, it } from "vitest";
import { buildOperatorBrief, type OperatorBriefInput } from "@/lib/bridge/operator-brief";

const baseInput: OperatorBriefInput = {
  latestRun: {
    decision: "go",
    confidence: "high",
    why: "Official and primary evidence support the recommendation.",
    blockingUnknowns: []
  },
  evidenceDiagnostics: {
    decisiveEvidenceScore: 0.9,
    falseConvergenceRisk: false,
    hasOfficialOrPrimaryEvidence: true,
    counterevidenceChecked: true,
    weakEvidence: false,
    sourceCoverageWarnings: []
  },
  evidenceReplay: {
    topClaims: [
      {
        text: "Research agents should diversify evidence sources before synthesis."
      }
    ],
    topCitations: [
      {
        artifactId: "official-citation",
        title: "Official Guidance",
        url: "https://platform.openai.com/docs/guides/research",
        priority: "official",
        sourceTier: "official",
        trustTier: "high"
      },
      {
        artifactId: "analysis-citation",
        title: "Analysis Source",
        url: "https://example.com/analysis",
        priority: "analysis",
        sourceTier: "unknown",
        trustTier: "medium"
      }
    ],
    topArtifacts: [
      {
        id: "search-page",
        title: "Search Page",
        url: "https://html.duckduckgo.com/html/?q=research",
        sourcePriority: "analysis",
        sourceTier: "aggregator",
        trustHint: "low",
        fetchStatus: "success"
      },
      {
        id: "timeout-artifact",
        title: "Timed Out Source",
        url: "https://example.com/timeout",
        sourcePriority: "primary_data",
        sourceTier: "primary",
        trustHint: "high",
        fetchStatus: "timeout"
      },
      {
        id: "official-citation",
        title: "Official Guidance",
        url: "https://platform.openai.com/docs/guides/research",
        sourcePriority: "official",
        sourceTier: "official",
        trustHint: "high",
        fetchStatus: "success"
      }
    ],
    unresolvedEvidenceGaps: []
  },
  retrievalAttemptGaps: null,
  repairAttempts: {
    sourceCoverage: {
      outcome: "followed_evidence",
      followedEvidence: {
        count: 1,
        artifacts: [
          {
            artifactId: "official-citation",
            url: "https://platform.openai.com/docs/guides/research",
            sourcePriority: "official",
            sourceTier: "official"
          }
        ]
      },
      failedFollowAttempts: {
        count: 1,
        artifacts: [
          {
            artifactId: "failed-source",
            url: "https://example.com/failed",
            fetchStatus: "timeout"
          }
        ]
      }
    },
    counterevidence: {
      outcome: "found_limitations",
      followedEvidence: {
        count: 1,
        artifacts: [
          {
            artifactId: "analysis-citation",
            url: "https://example.com/analysis",
            sourcePriority: "analysis",
            sourceTier: "unknown",
            repairCounterevidenceKind: "limitation",
            fetchStatus: "success"
          }
        ]
      },
      failedFollowAttempts: {
        count: 0,
        artifacts: []
      }
    }
  }
};

describe("buildOperatorBrief", () => {
  it("derives usable status for high-quality official/primary evidence", () => {
    const brief = buildOperatorBrief(baseInput);

    expect(brief.version).toBe("v0");
    expect(brief.confidenceStatus).toBe("usable");
    expect(brief.decisionSummary).toContain("go (high)");
    expect(brief.keyFindings).toEqual([
      "Research agents should diversify evidence sources before synthesis."
    ]);
    expect(brief.repairSummary).toEqual({
      sourceCoverageOutcome: "followed_evidence",
      counterevidenceOutcome: "found_limitations",
      sourceCoverageFollowedCount: 1,
      counterevidenceFollowedCount: 1,
      failedFollowAttemptCount: 1
    });
  });

  it("uses conservative not_ready status for false convergence, weak evidence, or no official evidence", () => {
    const brief = buildOperatorBrief({
      ...baseInput,
      evidenceDiagnostics: {
        ...baseInput.evidenceDiagnostics!,
        falseConvergenceRisk: true,
        weakEvidence: true,
        hasOfficialOrPrimaryEvidence: false
      }
    });

    expect(brief.confidenceStatus).toBe("not_ready");
    expect(brief.operatorNextActions).toContain(
      "Collect or repair official/primary evidence before using this result."
    );
    expect(brief.doNotOverclaim).toContain(
      "Do not claim the conclusion is settled while falseConvergenceRisk is true."
    );
  });

  it("uses caution when a go/no-go decision has unchecked counterevidence or partial repair", () => {
    const brief = buildOperatorBrief({
      ...baseInput,
      evidenceDiagnostics: {
        ...baseInput.evidenceDiagnostics!,
        counterevidenceChecked: false
      },
      repairAttempts: {
        ...baseInput.repairAttempts,
        counterevidence: {
          ...baseInput.repairAttempts.counterevidence,
          outcome: "failed_discovery"
        }
      }
    });

    expect(brief.confidenceStatus).toBe("usable_with_caution");
    expect(brief.operatorNextActions).toContain(
      "Retry counterevidence check or use a different discovery source."
    );
    expect(brief.doNotOverclaim).toContain(
      "Do not claim counterevidence was checked if counterevidenceChecked is false or repair failed."
    );
  });

  it("keeps strongest evidence usable and ranked while excluding failed and search artifacts", () => {
    const brief = buildOperatorBrief(baseInput);

    expect(brief.strongestEvidence.map((item) => item.artifactId)).toEqual([
      "official-citation",
      "analysis-citation"
    ]);
    expect(brief.strongestEvidence[0]).toMatchObject({
      artifactId: "official-citation",
      sourcePriority: "official",
      sourceTier: "official"
    });
    expect(brief.strongestEvidence).not.toContainEqual(
      expect.objectContaining({ artifactId: "search-page" })
    );
    expect(brief.strongestEvidence).not.toContainEqual(
      expect.objectContaining({ artifactId: "timeout-artifact" })
    );
    expect(brief.strongestEvidence).not.toContainEqual(
      expect.objectContaining({ artifactId: "failed-source" })
    );
  });

  it("merges unresolved gaps from diagnostics, repairs, blocking unknowns, and retrieval gaps", () => {
    const brief = buildOperatorBrief({
      ...baseInput,
      latestRun: {
        ...baseInput.latestRun,
        blockingUnknowns: ["validate retention curve"]
      },
      evidenceReplay: {
        ...baseInput.evidenceReplay,
        unresolvedEvidenceGaps: ["counterevidence_not_checked"]
      },
      evidenceDiagnostics: {
        ...baseInput.evidenceDiagnostics!,
        sourceCoverageWarnings: ["single_priority_evidence"]
      },
      retrievalAttemptGaps: {
        summary: {
          emptyResultCount: 2,
          droppedAttemptCount: 1
        }
      },
      repairAttempts: {
        ...baseInput.repairAttempts,
        sourceCoverage: {
          ...baseInput.repairAttempts.sourceCoverage,
          outcome: "no_candidates"
        }
      }
    });

    expect(brief.confidenceStatus).toBe("not_ready");
    expect(brief.unresolvedGaps).toEqual([
      "counterevidence_not_checked",
      "validate retention curve",
      "single_priority_evidence",
      "source_coverage_no_candidates",
      "empty_retrieval_results:2",
      "dropped_retrieval_attempts:1"
    ]);
    expect(brief.operatorNextActions).toContain(
      "Retry source coverage discovery or provide seed official sources."
    );
  });

  it("is inconclusive when diagnostics are missing", () => {
    const brief = buildOperatorBrief({
      ...baseInput,
      evidenceDiagnostics: null
    });

    expect(brief.confidenceStatus).toBe("inconclusive");
  });
});
