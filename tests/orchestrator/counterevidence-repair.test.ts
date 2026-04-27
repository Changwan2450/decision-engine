import { describe, expect, it } from "vitest";
import type { Claim, Contradiction, EvidenceSummary } from "@/lib/domain/claims";
import { planCounterevidenceRepair } from "@/lib/orchestrator/counterevidence-repair";

const supportClaim: Claim = {
  id: "claim-support",
  artifactId: "artifact-support",
  text: "Research agents should check competing evidence before converging.",
  stance: "support",
  citationIds: ["citation-support"]
};

const opposeClaim: Claim = {
  id: "claim-oppose",
  artifactId: "artifact-oppose",
  text: "Counterevidence checks are unnecessary for this topic.",
  stance: "oppose",
  citationIds: ["citation-oppose"]
};

const contradiction: Contradiction = {
  id: "contradiction-0",
  claimIds: ["claim-support", "claim-oppose"],
  status: "flagged",
  resolution: "unresolved"
};

const summary: EvidenceSummary = {
  shouldRemainUnclear: false,
  reasons: [],
  highestPrioritySeen: "official",
  decisiveEvidenceScore: 0.6,
  falseConvergenceRisk: true,
  convergenceRiskReasons: [
    "support_only_evidence",
    "counterevidence_not_checked",
    "weak_evidence",
    "false_convergence_risk"
  ],
  counterevidenceChecked: false,
  supportOnlyEvidence: true,
  weakEvidence: true,
  claimCount: 1,
  contradictionCount: 0
};

describe("planCounterevidenceRepair", () => {
  it("triggers when counterevidence is unchecked and support evidence exists", () => {
    const plan = planCounterevidenceRepair({
      title: "Research agents and false convergence",
      evidenceSummary: summary,
      claims: [supportClaim],
      contradictions: []
    });

    expect(plan.shouldAttempt).toBe(true);
    expect(plan.maxCandidates).toBe(5);
    expect(plan.maxFollowUrls).toBe(2);
  });

  it("does not trigger when no support claim exists", () => {
    const plan = planCounterevidenceRepair({
      title: "Research agents",
      evidenceSummary: summary,
      claims: [],
      contradictions: []
    });

    expect(plan.shouldAttempt).toBe(false);
    expect(plan.queries).toEqual([]);
  });

  it("does not trigger when oppose claims already exist", () => {
    const plan = planCounterevidenceRepair({
      title: "Research agents",
      evidenceSummary: summary,
      claims: [supportClaim, opposeClaim],
      contradictions: []
    });

    expect(plan.shouldAttempt).toBe(false);
  });

  it("does not trigger when contradictions already exist", () => {
    const plan = planCounterevidenceRepair({
      title: "Research agents",
      evidenceSummary: summary,
      claims: [supportClaim],
      contradictions: [contradiction]
    });

    expect(plan.shouldAttempt).toBe(false);
  });

  it("does not trigger when counterevidence is already checked", () => {
    const plan = planCounterevidenceRepair({
      title: "Research agents",
      evidenceSummary: {
        ...summary,
        counterevidenceChecked: true
      },
      claims: [supportClaim],
      contradictions: []
    });

    expect(plan.shouldAttempt).toBe(false);
  });

  it("generates max 2 deterministic bounded queries", () => {
    const plan = planCounterevidenceRepair({
      title: "How should research agents prevent false convergence and source over-reliance?",
      goal: "How should research agents prevent false convergence and source over-reliance?",
      evidenceSummary: summary,
      claims: [supportClaim],
      contradictions: []
    });

    expect(plan.queries).toEqual([
      "How should research agents prevent false convergence and source over-reliance limitations risks failure cases",
      "How should research agents prevent false convergence and source over-reliance evaluation limitations benchmark disagreement known issues"
    ]);
    expect(plan.queries).toHaveLength(2);
    expect(plan.queries.every((query) => query.length <= 180)).toBe(true);
  });

  it("includes prioritized diagnostic reasons when present", () => {
    const plan = planCounterevidenceRepair({
      title: "Research agents",
      evidenceSummary: summary,
      claims: [supportClaim],
      contradictions: []
    });

    expect(plan.reasons).toEqual([
      "false_convergence_risk",
      "support_only_evidence",
      "weak_evidence",
      "counterevidence_not_checked"
    ]);
  });

  it("sanitizes noisy query strings without adding criticism by default", () => {
    const plan = planCounterevidenceRepair({
      title: "Research agents <script>alert(1)</script> prevent false convergence criticism",
      evidenceSummary: summary,
      claims: [supportClaim],
      contradictions: []
    });

    expect(plan.queries.join(" ")).not.toContain("<script>");
    expect(plan.queries[0]).toContain("limitations risks failure cases");
    expect(plan.queries[1]).toContain("evaluation limitations benchmark disagreement known issues");
  });
});
