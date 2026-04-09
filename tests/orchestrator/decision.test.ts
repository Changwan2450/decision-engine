import { describe, expect, it } from "vitest";
import type { EvidenceSynthesis } from "@/lib/orchestrator/insights";
import { buildDecision } from "@/lib/orchestrator/decision";
import { buildPrdSeed } from "@/lib/orchestrator/prd-seed";

function baseEvidence(): EvidenceSynthesis {
  return {
    artifacts: [],
    citations: [
      {
        id: "citation-0",
        artifactId: "artifact-0",
        url: "https://example.com/official",
        title: "Official source",
        priority: "official",
        publishedAt: "2026-04-09T00:00:00.000Z"
      }
    ],
    claims: [
      {
        id: "claim-0",
        artifactId: "artifact-0",
        text: "Short-form demand is growing.",
        topicKey: "short-form-demand",
        stance: "support",
        citationIds: ["citation-0"]
      }
    ],
    contradictions: [],
    summary: {
      shouldRemainUnclear: false,
      reasons: [],
      highestPrioritySeen: "official",
      claimCount: 1,
      contradictionCount: 0
    }
  };
}

describe("decision layer", () => {
  it("returns go when evidence is strong and conflicts are absent", () => {
    const evidence = baseEvidence();

    const decision = buildDecision(evidence, {
      runTitle: "숏츠 시장 진입",
      goal: "숏츠 시장 진입 여부 판단"
    });

    expect(decision).toMatchObject({
      value: "go",
      confidence: "high"
    });
    expect(decision.blockingUnknowns).toEqual([]);
  });

  it("returns unclear when unclear signals are present", () => {
    const evidence = {
      ...baseEvidence(),
      summary: {
        shouldRemainUnclear: true,
        reasons: ["contradiction_detected"],
        highestPrioritySeen: "official",
        claimCount: 2,
        contradictionCount: 1
      },
      contradictions: [
        {
          id: "contradiction-0",
          claimIds: ["claim-0", "claim-1"],
          status: "flagged",
          resolution: "unresolved"
        }
      ]
    } satisfies EvidenceSynthesis;

    const decision = buildDecision(evidence, {
      runTitle: "숏츠 시장 진입",
      goal: "숏츠 시장 진입 여부 판단"
    });

    expect(decision).toMatchObject({
      value: "unclear",
      confidence: "low"
    });
    expect(decision.blockingUnknowns).toContain("충돌하는 핵심 주장을 해소해야 한다.");
  });

  it("returns no_go when evidence is negative without unclear signals", () => {
    const evidence = {
      ...baseEvidence(),
      claims: [
        {
          id: "claim-0",
          artifactId: "artifact-0",
          text: "Short-form ROI is too low for this audience.",
          topicKey: "short-form-roi",
          stance: "oppose",
          citationIds: ["citation-0"]
        }
      ]
    } satisfies EvidenceSynthesis;

    const decision = buildDecision(evidence, {
      runTitle: "숏츠 시장 진입",
      goal: "숏츠 시장 진입 여부 판단"
    });

    expect(decision).toMatchObject({
      value: "no_go",
      confidence: "high"
    });
  });
});

describe("prd seed", () => {
  it("reflects decision posture in feature and risk output", () => {
    const evidence = {
      ...baseEvidence(),
      summary: {
        shouldRemainUnclear: true,
        reasons: ["recency_gap"],
        highestPrioritySeen: "analysis",
        claimCount: 1,
        contradictionCount: 0
      }
    } satisfies EvidenceSynthesis;

    const decision = buildDecision(evidence, {
      runTitle: "숏츠 시장 진입",
      goal: "숏츠 시장 진입 여부 판단",
      target: "20대 크리에이터"
    });

    const prdSeed = buildPrdSeed(decision, evidence, {
      runTitle: "숏츠 시장 진입",
      target: "20대 크리에이터",
      comparisonAxis: "쇼츠 vs 릴스"
    });

    expect(prdSeed.targetUser).toBe("20대 크리에이터");
    expect(prdSeed.problem).toContain("숏츠 시장 진입");
    expect(prdSeed.solutionHypothesis).toContain("재검증");
    expect(prdSeed.featureCandidates[0]).toContain("검증");
    expect(prdSeed.risk[0]).toContain("최신성");
  });
});
