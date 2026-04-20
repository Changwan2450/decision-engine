import { describe, expect, it } from "vitest";
import { deriveTitleFromUrl } from "@/lib/adapters/contract";
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

  it("excludes non-anchor prior claims from contradiction pairing while keeping external pairs", () => {
    const artifacts: SourceArtifact[] = [
      {
        id: "artifact-prior",
        adapter: "kb-preread",
        sourceType: "kb",
        title: "KB Wiki Prior",
        url: "https://kb.local/wiki/test",
        snippet: "",
        content: "",
        sourcePriority: "analysis",
        metadata: {
          claims_json: JSON.stringify([
            {
              text: "쇼츠 파이프라인은 안정적이다",
              topicKey: "project-prior",
              stance: "support"
            }
          ])
        }
      },
      {
        id: "artifact-support",
        adapter: "scrapling",
        sourceType: "community",
        title: "Reddit: RSC authentication success",
        url: "https://example.com/reddit-support",
        snippet: "",
        content: "- I'd recommend RSC authentication in production",
        sourcePriority: "community",
        metadata: {}
      },
      {
        id: "artifact-oppose",
        adapter: "scrapling",
        sourceType: "community",
        title: "Reddit: RSC authentication nightmare",
        url: "https://example.com/reddit-oppose",
        snippet: "",
        content: "- RSC authentication is a nightmare",
        sourcePriority: "community",
        metadata: {}
      }
    ];

    const synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now: "2026-04-19T00:00:00.000Z",
      recencySensitive: false
    });

    expect(synthesis.claims[0].topicKey).toBe("project-prior");
    expect(synthesis.claims[1].topicKey).toBe("rsc-authentication");
    expect(synthesis.claims[2].topicKey).toBe("rsc-authentication");
    expect(synthesis.contradictions).toHaveLength(1);
    expect(synthesis.contradictions[0].claimIds).toEqual(["claim-1", "claim-2"]);
  });

  it("skips contradictions when both claims use topic keys outside the run anchors", () => {
    const artifacts: SourceArtifact[] = [
      {
        id: "artifact-support",
        adapter: "kb-preread",
        sourceType: "kb",
        title: "KB Wiki Prior",
        url: "https://kb.local/wiki/support",
        snippet: "",
        content: "",
        sourcePriority: "analysis",
        metadata: {
          claims_json: JSON.stringify([
            {
              text: "alpha growth",
              topicKey: "project-prior",
              stance: "support"
            }
          ])
        }
      },
      {
        id: "artifact-oppose",
        adapter: "kb-preread",
        sourceType: "kb",
        title: "KB Wiki Prior",
        url: "https://kb.local/wiki/oppose",
        snippet: "",
        content: "",
        sourcePriority: "analysis",
        metadata: {
          claims_json: JSON.stringify([
            {
              text: "beta decline",
              topicKey: "project-prior",
              stance: "oppose"
            }
          ])
        }
      }
    ];

    const synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now: "2026-04-19T00:00:00.000Z",
      recencySensitive: false
    });

    expect(synthesis.contradictions).toHaveLength(0);
  });

  it("preserves project-prior-decision topic keys instead of reassigning them from evidence-gap text", () => {
    const artifacts: SourceArtifact[] = [
      {
        id: "artifact-prior-decision",
        adapter: "kb-preread",
        sourceType: "kb",
        title: "Decision History Prior",
        url: "https://kb.local/decision-history/test",
        snippet: "",
        content: "",
        sourcePriority: "analysis",
        metadata: {
          claims_json: JSON.stringify([
            {
              text: "monorepo vs polyrepo — solo 개발자 선택: 저장소 전략 결정을 확정하기에는 증거 공백이 남아 있다.",
              topicKey: "project-prior-decision",
              stance: "neutral"
            }
          ])
        }
      },
      {
        id: "artifact-community",
        adapter: "community-search-json",
        sourceType: "community",
        title: "Monorepo vs Polyrepo for AI-driven development",
        url: "https://reddit.com/r/ExperiencedDevs/comments/1siqkc5/monorepo_vs_polyrepo_for_aidriven_development/",
        snippet: "",
        content: "Short background: our system has always been in a monorepo.",
        sourcePriority: "community",
        metadata: {
          claims_json: JSON.stringify([
            {
              text: "Monorepo improves AI effectiveness.",
              topicKey: "monorepo",
              stance: "support"
            }
          ])
        }
      }
    ];

    const synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now: "2026-04-20T00:00:00.000Z",
      recencySensitive: false
    });

    expect(synthesis.claims[0].topicKey).toBe("project-prior-decision");
    expect(synthesis.claims[1].topicKey).toBe("monorepo");
  });

  it("does not use url-derived titles as anchor context", () => {
    const derivedUrl = "https://reddit.com/react_server_components";
    const artifacts: SourceArtifact[] = [
      {
        id: "artifact-anchor",
        adapter: "scrapling",
        sourceType: "community",
        title: "React Server Components guide",
        url: "https://example.com/rsc-guide",
        snippet: "",
        content: [
          "- React Server Components help with large apps",
          "- React Server Components reduce client bundle size"
        ].join("\n"),
        sourcePriority: "community",
        metadata: {}
      },
      {
        id: "artifact-derived",
        adapter: "community-search-json",
        sourceType: "community",
        title: deriveTitleFromUrl(derivedUrl),
        url: derivedUrl,
        snippet: "",
        content: "- I support this approach",
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
    expect(synthesis.claims[2].topicKey).toBeUndefined();
  });

  it("suppresses fallback claims for blocked artifacts without claims_json", () => {
    const artifacts: SourceArtifact[] = [
      {
        id: "artifact-blocked",
        adapter: "scrapling",
        sourceType: "web",
        title: "s.jina.ai",
        url: "https://s.jina.ai/?q=monorepo",
        snippet: "",
        content: "{\"data\":null,\"code\":401,\"message\":\"Authentication is required\"}",
        sourcePriority: "analysis",
        metadata: {
          fetch_status: "blocked",
          block_reason: "login",
          login_required: "true"
        }
      }
    ];

    const synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now: "2026-04-20T00:00:00.000Z",
      recencySensitive: false
    });

    expect(synthesis.claims).toHaveLength(0);
    expect(synthesis.contradictions).toHaveLength(0);
  });

  it("suppresses fallback claims for raw listing-style JSON bodies", () => {
    const artifacts: SourceArtifact[] = [
      {
        id: "artifact-json",
        adapter: "scrapling",
        sourceType: "web",
        title: "search listing",
        url: "https://example.com/listing",
        snippet: "",
        content: "{\"kind\":\"Listing\",\"data\":{\"children\":[]}}",
        sourcePriority: "analysis",
        metadata: {}
      }
    ];

    const synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now: "2026-04-20T00:00:00.000Z",
      recencySensitive: false
    });

    expect(synthesis.claims).toHaveLength(0);
    expect(synthesis.contradictions).toHaveLength(0);
  });

  it("keeps real titles in anchor context", () => {
    const artifacts: SourceArtifact[] = [
      {
        id: "artifact-anchor",
        adapter: "scrapling",
        sourceType: "community",
        title: "React Server Components guide",
        url: "https://example.com/rsc-guide",
        snippet: "",
        content: [
          "- React Server Components help with large apps",
          "- React Server Components reduce client bundle size"
        ].join("\n"),
        sourcePriority: "community",
        metadata: {}
      },
      {
        id: "artifact-real-title",
        adapter: "community-search-json",
        sourceType: "community",
        title: "React Server Components tradeoffs",
        url: "https://reddit.com/r/example/comments/abc",
        snippet: "",
        content: "- I support this approach",
        sourcePriority: "community",
        metadata: {}
      }
    ];

    const synthesis = synthesizeEvidenceFromArtifacts(artifacts, {
      now: "2026-04-19T00:00:00.000Z",
      recencySensitive: false
    });

    expect(synthesis.claims[2].topicKey).toBe("react-server-components");
  });
});
