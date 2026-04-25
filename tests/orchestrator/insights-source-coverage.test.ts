import { describe, expect, it } from "vitest";
import type { SourceArtifact } from "@/lib/adapters/types";
import type { Citation } from "@/lib/domain/claims";
import {
  computeSourceCoverageDiagnostics,
  synthesizeEvidenceFromArtifacts
} from "@/lib/orchestrator/insights";

function citation(
  priority: Citation["priority"],
  sourceTier?: Citation["sourceTier"],
  id = `${priority}-${sourceTier ?? "missing"}`
): Citation {
  return {
    id: `citation-${id}`,
    artifactId: `artifact-${id}`,
    url: `https://example.com/${id}`,
    title: `${id} source`,
    priority,
    sourceTier
  };
}

describe("computeSourceCoverageDiagnostics", () => {
  it("counts priorities deterministically", () => {
    const diagnostics = computeSourceCoverageDiagnostics([
      citation("official"),
      citation("primary_data"),
      citation("analysis"),
      citation("community")
    ]);

    expect(diagnostics.sourcePriorityCounts).toEqual({
      official: 1,
      primary_data: 1,
      analysis: 1,
      community: 1
    });
  });

  it("counts source tiers deterministically", () => {
    const diagnostics = computeSourceCoverageDiagnostics([
      citation("official", "official"),
      citation("primary_data", "primary"),
      citation("analysis", "internal"),
      citation("community", "community"),
      citation("analysis", "aggregator"),
      citation("community", "unknown")
    ]);

    expect(diagnostics.sourceTierCounts).toEqual({
      official: 1,
      primary: 1,
      internal: 1,
      community: 1,
      aggregator: 1,
      unknown: 1
    });
  });

  it("treats missing sourceTier as unknown", () => {
    const diagnostics = computeSourceCoverageDiagnostics([
      citation("analysis", undefined, "analysis-missing-tier")
    ]);

    expect(diagnostics.sourceTierCounts.unknown).toBe(1);
  });

  it("computes sourcePriorityDiversity as non-zero priority buckets", () => {
    const diagnostics = computeSourceCoverageDiagnostics([
      citation("official"),
      citation("official", "official", "official-2"),
      citation("community")
    ]);

    expect(diagnostics.sourcePriorityDiversity).toBe(2);
  });

  it("sets hasOfficialOrPrimaryEvidence true when official priority exists", () => {
    const diagnostics = computeSourceCoverageDiagnostics([
      citation("official"),
      citation("community")
    ]);

    expect(diagnostics.hasOfficialOrPrimaryEvidence).toBe(true);
  });

  it("sets hasOfficialOrPrimaryEvidence true when primary_data priority exists", () => {
    const diagnostics = computeSourceCoverageDiagnostics([
      citation("primary_data"),
      citation("community")
    ]);

    expect(diagnostics.hasOfficialOrPrimaryEvidence).toBe(true);
  });

  it("sets hasOfficialOrPrimaryEvidence false when only analysis and community exist", () => {
    const diagnostics = computeSourceCoverageDiagnostics([
      citation("analysis"),
      citation("community")
    ]);

    expect(diagnostics.hasOfficialOrPrimaryEvidence).toBe(false);
  });

  it("sets aggregatorOnlyEvidence true only when every citation has aggregator sourceTier", () => {
    const diagnostics = computeSourceCoverageDiagnostics([
      citation("analysis", "aggregator"),
      citation("community", "aggregator")
    ]);

    expect(diagnostics.aggregatorOnlyEvidence).toBe(true);
  });

  it("sets aggregatorOnlyEvidence false for mixed aggregator and non-aggregator evidence", () => {
    const diagnostics = computeSourceCoverageDiagnostics([
      citation("analysis", "aggregator"),
      citation("community", "community")
    ]);

    expect(diagnostics.aggregatorOnlyEvidence).toBe(false);
  });

  it("emits sourceCoverageWarnings in deterministic order", () => {
    const diagnostics = computeSourceCoverageDiagnostics([
      citation("analysis", "aggregator"),
      citation("analysis", "aggregator", "analysis-aggregator-2")
    ]);

    expect(diagnostics.sourceCoverageWarnings).toEqual([
      "no_official_or_primary_evidence",
      "aggregator_only_evidence",
      "single_priority_evidence"
    ]);
  });

  it("emits single_priority_evidence when only one priority bucket exists and citations are non-empty", () => {
    const diagnostics = computeSourceCoverageDiagnostics([
      citation("community", "community"),
      citation("community", "community", "community-2")
    ]);

    expect(diagnostics.sourceCoverageWarnings).toContain("single_priority_evidence");
  });
});

describe("synthesizeEvidenceFromArtifacts source coverage diagnostics", () => {
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
      sourceTier: "official",
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
      sourceTier: "community",
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

  it("emits all six source coverage diagnostic fields", () => {
    const synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now: "2026-04-09T12:00:00.000Z",
      recencySensitive: false
    });

    expect(synthesis.summary.sourcePriorityCounts).toEqual({
      official: 1,
      primary_data: 0,
      analysis: 0,
      community: 1
    });
    expect(synthesis.summary.sourceTierCounts).toEqual({
      official: 1,
      primary: 0,
      internal: 0,
      community: 1,
      aggregator: 0,
      unknown: 0
    });
    expect(typeof synthesis.summary.sourcePriorityDiversity).toBe("number");
    expect(typeof synthesis.summary.hasOfficialOrPrimaryEvidence).toBe("boolean");
    expect(typeof synthesis.summary.aggregatorOnlyEvidence).toBe("boolean");
    expect(Array.isArray(synthesis.summary.sourceCoverageWarnings)).toBe(true);
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
    expect(synthesis.summary.falseConvergenceRisk).toBe(false);
    expect(synthesis.summary.convergenceRiskReasons).toEqual([
      "support_only_evidence",
      "counterevidence_not_checked"
    ]);
    expect(synthesis.summary.counterevidenceChecked).toBe(false);
    expect(synthesis.summary.supportOnlyEvidence).toBe(true);
    expect(synthesis.summary.weakEvidence).toBe(false);
  });
});
