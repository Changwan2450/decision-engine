import { describe, expect, it } from "vitest";
import type { SourceArtifact } from "@/lib/adapters/types";
import {
  synthesizeEvidenceFromArtifacts,
  type EvidenceSynthesis
} from "@/lib/orchestrator/insights";

describe("evidence synthesis", () => {
  it("keeps artifacts separate from claims and flags contradictions by claim", () => {
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
            },
            {
              text: "Creators monetize faster with short-form loops.",
              topicKey: "creator-monetization",
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
              text: "Short-form demand is shrinking.",
              topicKey: "short-form-demand",
              stance: "oppose"
            }
          ])
        }
      }
    ];

    const synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now: "2026-04-09T12:00:00.000Z",
      recencySensitive: false
    });

    expect(synthesis.artifacts).toHaveLength(2);
    expect(synthesis.claims).toHaveLength(3);
    expect(synthesis.citations.map((citation) => citation.priority)).toEqual([
      "official",
      "community"
    ]);
    expect(synthesis.contradictions).toHaveLength(1);
    expect(synthesis.contradictions[0]).toMatchObject({
      claimIds: ["claim-0", "claim-2"],
      status: "flagged",
      resolution: "unresolved"
    });
    expect(synthesis.summary.shouldRemainUnclear).toBe(true);
    expect(synthesis.summary.reasons).toContain("contradiction_detected");
  });

  it("stays unclear when the topic is recency-sensitive and evidence is stale", () => {
    const artifacts: SourceArtifact[] = [
      {
        id: "artifact-analysis",
        adapter: "agent-reach",
        sourceType: "web",
        title: "Trend write-up",
        url: "https://example.com/trends",
        snippet: "",
        content: "",
        sourcePriority: "analysis",
        publishedAt: "2026-02-01T00:00:00.000Z",
        metadata: {
          claims_json: JSON.stringify([
            {
              text: "Short-form shopping demand is accelerating.",
              topicKey: "short-form-shopping-demand",
              stance: "support"
            }
          ])
        }
      }
    ];

    const synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now: "2026-04-09T12:00:00.000Z",
      recencySensitive: true
    });

    expect(synthesis.summary.shouldRemainUnclear).toBe(true);
    expect(synthesis.summary.reasons).toEqual([
      "recency_gap",
      "insufficient_high_priority_support"
    ]);
  });
});
