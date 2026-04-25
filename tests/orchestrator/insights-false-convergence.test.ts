import { describe, expect, it } from "vitest";
import type { SourceArtifact } from "@/lib/adapters/types";
import type { Citation, Claim, Contradiction } from "@/lib/domain/claims";
import {
  computeFalseConvergenceDiagnostics,
  synthesizeEvidenceFromArtifacts
} from "@/lib/orchestrator/insights";

function citation(priority: Citation["priority"], id = priority): Citation {
  return {
    id: `citation-${id}`,
    artifactId: `artifact-${id}`,
    url: `https://example.com/${id}`,
    title: `${id} source`,
    priority
  };
}

function claim(stance: Claim["stance"], id = stance): Claim {
  return {
    id: `claim-${id}`,
    artifactId: `artifact-${id}`,
    text: `${stance} claim`,
    stance,
    citationIds: [`citation-${id}`]
  };
}

const contradiction: Contradiction = {
  id: "contradiction-0",
  claimIds: ["claim-support", "claim-oppose"],
  status: "flagged",
  resolution: "unresolved"
};

describe("computeFalseConvergenceDiagnostics", () => {
  it("detects support-only evidence", () => {
    const diagnostics = computeFalseConvergenceDiagnostics(
      [citation("community")],
      [claim("support")],
      [],
      0.4
    );

    expect(diagnostics.supportOnlyEvidence).toBe(true);
    expect(diagnostics.counterevidenceChecked).toBe(false);
  });

  it("marks counterevidence checked when an oppose claim exists", () => {
    const diagnostics = computeFalseConvergenceDiagnostics(
      [citation("community")],
      [claim("support"), claim("oppose")],
      [],
      0.4
    );

    expect(diagnostics.counterevidenceChecked).toBe(true);
    expect(diagnostics.supportOnlyEvidence).toBe(false);
  });

  it("marks counterevidence checked when a contradiction exists", () => {
    const diagnostics = computeFalseConvergenceDiagnostics(
      [citation("community")],
      [claim("support")],
      [contradiction],
      0.4
    );

    expect(diagnostics.counterevidenceChecked).toBe(true);
    expect(diagnostics.supportOnlyEvidence).toBe(false);
  });

  it("detects weak evidence when decisiveEvidenceScore is below 0.75", () => {
    const diagnostics = computeFalseConvergenceDiagnostics(
      [citation("community")],
      [claim("support")],
      [],
      0.74
    );

    expect(diagnostics.weakEvidence).toBe(true);
  });

  it("does not detect weak evidence when decisiveEvidenceScore is at least 0.75", () => {
    const diagnostics = computeFalseConvergenceDiagnostics(
      [citation("official")],
      [claim("support")],
      [],
      0.75
    );

    expect(diagnostics.weakEvidence).toBe(false);
  });

  it("sets falseConvergenceRisk only when supportOnlyEvidence and weakEvidence are true", () => {
    const risky = computeFalseConvergenceDiagnostics(
      [citation("community")],
      [claim("support")],
      [],
      0.4
    );
    const strongSupportOnly = computeFalseConvergenceDiagnostics(
      [citation("official")],
      [claim("support")],
      [],
      0.8
    );
    const weakWithCounterevidence = computeFalseConvergenceDiagnostics(
      [citation("community")],
      [claim("support"), claim("oppose")],
      [],
      0.4
    );

    expect(risky.falseConvergenceRisk).toBe(true);
    expect(strongSupportOnly.falseConvergenceRisk).toBe(false);
    expect(weakWithCounterevidence.falseConvergenceRisk).toBe(false);
  });

  it("emits convergenceRiskReasons in deterministic order", () => {
    const diagnostics = computeFalseConvergenceDiagnostics(
      [citation("community")],
      [claim("support")],
      [],
      0.4
    );

    expect(diagnostics.convergenceRiskReasons).toEqual([
      "support_only_evidence",
      "counterevidence_not_checked",
      "weak_evidence",
      "false_convergence_risk"
    ]);
  });
});

describe("synthesizeEvidenceFromArtifacts false-convergence diagnostics", () => {
  const artifacts: SourceArtifact[] = [
    {
      id: "artifact-official",
      adapter: "agent-reach",
      sourceType: "web",
      title: "Official report",
      url: "https://example.com/official",
      snippet: "",
      content: "",
      sourcePriority: "official",
      publishedAt: "2026-04-09T00:00:00.000Z",
      metadata: {
        claims_json: JSON.stringify([
          {
            text: "Short-form demand is growing.",
            topicKey: "short-form-demand",
            stance: "support"
          }
        ])
      }
    },
    {
      id: "artifact-community",
      adapter: "agent-reach",
      sourceType: "community",
      title: "Community thread",
      url: "https://example.com/thread",
      snippet: "",
      content: "",
      sourcePriority: "community",
      publishedAt: "2026-04-08T00:00:00.000Z",
      metadata: {
        claims_json: JSON.stringify([
          {
            text: "Short-form demand is still growing.",
            topicKey: "short-form-demand",
            stance: "support"
          }
        ])
      }
    }
  ];

  it("emits all five diagnostic fields", () => {
    const synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now: "2026-04-09T12:00:00.000Z",
      recencySensitive: false
    });

    expect(typeof synthesis.summary.falseConvergenceRisk).toBe("boolean");
    expect(Array.isArray(synthesis.summary.convergenceRiskReasons)).toBe(true);
    expect(typeof synthesis.summary.counterevidenceChecked).toBe("boolean");
    expect(typeof synthesis.summary.supportOnlyEvidence).toBe("boolean");
    expect(typeof synthesis.summary.weakEvidence).toBe("boolean");
  });

  it("keeps existing evidence summary fields stable", () => {
    const synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now: "2026-04-09T12:00:00.000Z",
      recencySensitive: false
    });

    expect(synthesis.summary.shouldRemainUnclear).toBe(false);
    expect(synthesis.summary.reasons).toEqual([]);
    expect(synthesis.summary.highestPrioritySeen).toBe("official");
    expect(synthesis.summary.claimCount).toBe(2);
    expect(synthesis.summary.contradictionCount).toBe(0);
    expect(typeof synthesis.summary.decisiveEvidenceScore).toBe("number");
    expect(synthesis.summary.decisiveEvidenceScore).toBeGreaterThanOrEqual(0);
    expect(synthesis.summary.decisiveEvidenceScore).toBeLessThanOrEqual(1);
  });
});
