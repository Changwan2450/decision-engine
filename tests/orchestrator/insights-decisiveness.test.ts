import { describe, expect, it } from "vitest";
import type { SourceArtifact } from "@/lib/adapters/types";
import type { Citation, Claim, Contradiction } from "@/lib/domain/claims";
import {
  computeDecisiveEvidenceScore,
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

describe("computeDecisiveEvidenceScore", () => {
  it("returns 0 when no support claims exist", () => {
    expect(
      computeDecisiveEvidenceScore(
        [citation("official")],
        [claim("oppose")],
        []
      )
    ).toBe(0);
  });

  it("stays <= 0.5 when only community support is present", () => {
    const score = computeDecisiveEvidenceScore(
      [citation("community")],
      [claim("support")],
      []
    );

    expect(score).toBeLessThanOrEqual(0.5);
  });

  it("is >= 0.7 when official or primary_data support is present without contradictions", () => {
    const officialScore = computeDecisiveEvidenceScore(
      [citation("official")],
      [claim("support")],
      []
    );
    const primaryScore = computeDecisiveEvidenceScore(
      [citation("primary_data")],
      [claim("support")],
      []
    );

    expect(officialScore).toBeGreaterThanOrEqual(0.7);
    expect(primaryScore).toBeGreaterThanOrEqual(0.7);
  });

  it("penalizes contradictions on the same support and citation set", () => {
    const citations = [citation("official"), citation("community", "community")];
    const claims = [claim("support")];

    const withoutContradiction = computeDecisiveEvidenceScore(citations, claims, []);
    const withContradiction = computeDecisiveEvidenceScore(citations, claims, [contradiction]);

    expect(withContradiction).toBeLessThan(withoutContradiction);
  });

  it("clamps score to [0, 1] under extreme synthetic inputs", () => {
    const highScore = computeDecisiveEvidenceScore(
      [
        citation("official"),
        citation("primary_data", "primary"),
        citation("analysis"),
        citation("community")
      ],
      [claim("support")],
      []
    );
    const lowScore = computeDecisiveEvidenceScore(
      [citation("community")],
      [claim("support")],
      [contradiction, { ...contradiction, id: "contradiction-1" }]
    );

    expect(highScore).toBeGreaterThanOrEqual(0);
    expect(highScore).toBeLessThanOrEqual(1);
    expect(lowScore).toBeGreaterThanOrEqual(0);
    expect(lowScore).toBeLessThanOrEqual(1);
  });

  it("is deterministic across identical calls", () => {
    const args = {
      citations: [citation("official"), citation("analysis")],
      claims: [claim("support")],
      contradictions: [contradiction]
    };

    expect(
      computeDecisiveEvidenceScore(args.citations, args.claims, args.contradictions)
    ).toBe(
      computeDecisiveEvidenceScore(args.citations, args.claims, args.contradictions)
    );
  });
});

describe("synthesizeEvidenceFromArtifacts decisiveness summary", () => {
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

  it("emits decisiveEvidenceScore in [0, 1]", () => {
    const synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now: "2026-04-09T12:00:00.000Z",
      recencySensitive: false
    });

    expect(typeof synthesis.summary.decisiveEvidenceScore).toBe("number");
    expect(synthesis.summary.decisiveEvidenceScore).toBeGreaterThanOrEqual(0);
    expect(synthesis.summary.decisiveEvidenceScore).toBeLessThanOrEqual(1);
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
  });
});
