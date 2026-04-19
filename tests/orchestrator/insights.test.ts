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

  it("infers oppose stance and topic keys from fallback claim text", () => {
    const artifacts: SourceArtifact[] = [
      {
        id: "artifact-support",
        adapter: "scrapling",
        sourceType: "web",
        title: "Official perspective",
        url: "https://example.com/official",
        snippet: "",
        content: ["- RSC is worth it for large teams", "- I'd recommend RSC despite the complexity"].join(
          "\n"
        ),
        sourcePriority: "analysis",
        metadata: {}
      },
      {
        id: "artifact-oppose",
        adapter: "scrapling",
        sourceType: "community",
        title: "Community perspective",
        url: "https://example.com/community",
        snippet: "",
        content: [
          "- I think the trade-off simply isn't worth it for RSC",
          "- massive mental overhead for little gain with RSC",
          "- React Server Components, maybe a mistake from the beginning?"
        ].join("\n"),
        sourcePriority: "community",
        metadata: {}
      }
    ];

    const synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now: "2026-04-19T00:00:00.000Z",
      recencySensitive: false
    });

    const opposeClaims = synthesis.claims.filter((claim) => claim.stance === "oppose");
    const keyedClaims = synthesis.claims.filter((claim) => claim.topicKey);

    expect(opposeClaims.length).toBeGreaterThanOrEqual(2);
    expect(keyedClaims.length).toBeGreaterThanOrEqual(4);
    expect(new Set(keyedClaims.map((claim) => claim.topicKey))).toContain("rsc");
    expect(synthesis.contradictions.length).toBeGreaterThanOrEqual(1);
  });

  it("reassigns topic keys from run-level anchors using artifact title context", () => {
    const artifacts: SourceArtifact[] = [
      {
        id: "artifact-support",
        adapter: "kb-preread",
        sourceType: "kb",
        title: "React Server Components - Ecosystem Thoughts",
        url: "https://kb.local/wiki/test",
        snippet: "",
        content: "",
        sourcePriority: "analysis",
        metadata: {
          claims_json: JSON.stringify([
            {
              text: "RSC is great for large apps",
              topicKey: "topic",
              stance: "support"
            }
          ])
        }
      },
      {
        id: "artifact-oppose",
        adapter: "scrapling",
        sourceType: "community",
        title: "Reddit: RSC authentication nightmare",
        url: "https://example.com/reddit",
        snippet: "",
        content: "- authentication with RSC is a nightmare",
        sourcePriority: "community",
        metadata: {}
      }
    ];

    const synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now: "2026-04-19T00:00:00.000Z",
      recencySensitive: false
    });

    expect(synthesis.claims[0].topicKey).toBe("react-server-components");
    expect(synthesis.claims[1].topicKey).toBe("react-server-components");
    expect(synthesis.contradictions).toHaveLength(1);
  });
});
