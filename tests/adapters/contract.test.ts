import { describe, expect, it } from "vitest";
import {
  REQUIRED_METADATA_KEYS,
  assertMetadataContract,
  buildArtifact,
  buildFailureArtifact,
  buildFetchMetadata,
  confidenceFromStatus,
  deriveTitleFromUrl
} from "@/lib/adapters/contract";
import { sourceArtifactSchema } from "@/lib/domain/claims";

describe("buildFetchMetadata()", () => {
  it("populates all required keys on success with defaults", () => {
    const md = buildFetchMetadata({
      fetcher: "scrapling",
      outcome: { status: "success" }
    });
    expect(md.fetcher).toBe("scrapling");
    expect(md.fetch_status).toBe("success");
    expect(md.block_reason).toBe("unknown"); // never empty
    expect(md.bypass_level).toBe("none");
    expect(md.login_required).toBe("false");
  });

  it("populates all required keys on blocked outcome", () => {
    const md = buildFetchMetadata({
      fetcher: "scrapling",
      outcome: {
        status: "blocked",
        blockReason: "turnstile",
        bypassLevel: "turnstile",
        loginRequired: true
      }
    });
    expect(md.fetch_status).toBe("blocked");
    expect(md.block_reason).toBe("turnstile");
    expect(md.bypass_level).toBe("turnstile");
    expect(md.login_required).toBe("true");
  });

  it("populates required keys on timeout and error as well", () => {
    const timeout = buildFetchMetadata({
      fetcher: "agent-reach",
      outcome: { status: "timeout" }
    });
    expect(timeout.fetch_status).toBe("timeout");
    expect(timeout.block_reason).toBe("unknown");
    expect(timeout.bypass_level).toBe("none");
    expect(timeout.login_required).toBe("false");

    const err = buildFetchMetadata({
      fetcher: "agent-reach",
      outcome: { status: "error" }
    });
    expect(err.fetch_status).toBe("error");
    expect(err.block_reason).toBe("unknown");
  });

  it("reserved keys cannot be overridden via extra", () => {
    const md = buildFetchMetadata({
      fetcher: "scrapling",
      outcome: { status: "success" },
      extra: {
        fetcher: "fake", // should be overridden by reserved fetcher
        fetch_status: "error", // reserved, ignored
        something_else: "kept"
      }
    });
    expect(md.fetcher).toBe("scrapling");
    expect(md.fetch_status).toBe("success");
    expect(md.something_else).toBe("kept");
  });

  it("drops empty / undefined extras to keep metadata shape clean", () => {
    const md = buildFetchMetadata({
      fetcher: "scrapling",
      outcome: { status: "success" },
      extra: {
        dropped_empty: "",
        dropped_undef: undefined,
        kept: "x"
      }
    });
    expect(md).not.toHaveProperty("dropped_empty");
    expect(md).not.toHaveProperty("dropped_undef");
    expect(md.kept).toBe("x");
  });

  it("attaches optional source_label and rate_limit_bucket", () => {
    const md = buildFetchMetadata({
      fetcher: "scrapling",
      outcome: { status: "success" },
      sourceLabel: "web/stealth",
      rateLimitBucket: "scrapling/stealth"
    });
    expect(md.source_label).toBe("web/stealth");
    expect(md.rate_limit_bucket).toBe("scrapling/stealth");
  });
});

describe("assertMetadataContract()", () => {
  it("passes for metadata built via buildFetchMetadata", () => {
    const md = buildFetchMetadata({
      fetcher: "scrapling",
      outcome: { status: "success" }
    });
    expect(() => assertMetadataContract(md)).not.toThrow();
  });

  it("throws when any required key is missing or empty", () => {
    const complete = buildFetchMetadata({
      fetcher: "scrapling",
      outcome: { status: "success" }
    });
    for (const key of REQUIRED_METADATA_KEYS) {
      const broken = { ...complete };
      delete broken[key];
      expect(() => assertMetadataContract(broken)).toThrow(/metadata contract/);
    }
  });
});

describe("buildArtifact()", () => {
  it("produces an artifact that zod-validates (full SourceArtifactRecord)", () => {
    const a = buildArtifact({
      id: "t-0",
      adapter: "scrapling",
      fetcher: "scrapling",
      sourceType: "web",
      url: "https://example.com/a",
      canonicalUrl: "https://example.com/a",
      title: "t",
      snippet: "s",
      content: "body",
      retrievedAt: "2026-04-17T00:00:00.000Z",
      language: "en",
      outcome: { status: "success" }
    });
    expect(sourceArtifactSchema.parse(a)).toBeTruthy();
  });

  it("fills required metadata even when title/snippet/content are empty", () => {
    const a = buildArtifact({
      id: "t-1",
      adapter: "scrapling",
      fetcher: "scrapling",
      sourceType: "web",
      url: "https://example.com/b",
      outcome: { status: "blocked", blockReason: "turnstile" }
    });
    expect(a.metadata.fetch_status).toBe("blocked");
    expect(a.metadata.block_reason).toBe("turnstile");
    expect(a.metadata.bypass_level).toBe("none");
    expect(a.metadata.login_required).toBe("false");
    // Placeholder title derived from URL
    expect(a.title.length).toBeGreaterThan(0);
  });

  it("clamps confidence into [0,1]", () => {
    expect(
      buildArtifact({
        id: "t-2",
        adapter: "x",
        fetcher: "x",
        sourceType: "web",
        url: "https://example.com",
        outcome: { status: "success" },
        confidence: 9.9
      }).confidence
    ).toBe(1);
    expect(
      buildArtifact({
        id: "t-3",
        adapter: "x",
        fetcher: "x",
        sourceType: "web",
        url: "https://example.com",
        outcome: { status: "success" },
        confidence: -1
      }).confidence
    ).toBe(0);
  });

  it("defaults confidence from status when not provided", () => {
    expect(confidenceFromStatus("success")).toBeGreaterThan(0.5);
    expect(confidenceFromStatus("blocked")).toBe(0);
    expect(confidenceFromStatus("timeout")).toBe(0);
    expect(confidenceFromStatus("error")).toBe(0);
  });
});

describe("buildFailureArtifact()", () => {
  it("produces a URL-carrying stub with full contract metadata", () => {
    const a = buildFailureArtifact({
      id: "f-0",
      adapter: "scrapling",
      fetcher: "scrapling",
      url: "https://example.com/blocked",
      sourceType: "web",
      outcome: { status: "timeout" },
      errorMessage: "connect ETIMEDOUT"
    });
    expect(a.url).toBe("https://example.com/blocked");
    expect(a.content).toBe("");
    expect(a.snippet).toBe("");
    expect(a.metadata.fetch_status).toBe("timeout");
    expect(a.metadata.block_reason).toBe("unknown");
    expect(a.metadata.bypass_level).toBe("none");
    expect(a.metadata.login_required).toBe("false");
    expect(a.metadata.error).toContain("ETIMEDOUT");
  });

  it("truncates very long error messages", () => {
    const big = "x".repeat(5000);
    const a = buildFailureArtifact({
      id: "f-1",
      adapter: "scrapling",
      fetcher: "scrapling",
      url: "https://example.com/x",
      sourceType: "web",
      outcome: { status: "error" },
      errorMessage: big
    });
    expect(a.metadata.error.length).toBeLessThan(600);
    expect(a.metadata.error.endsWith("...")).toBe(true);
  });
});

describe("deriveTitleFromUrl()", () => {
  it("returns hostname/last-segment", () => {
    expect(deriveTitleFromUrl("https://example.com/path/to/thing")).toBe(
      "example.com/thing"
    );
  });
  it("returns hostname alone when root", () => {
    expect(deriveTitleFromUrl("https://example.com/")).toBe("example.com");
  });
  it("returns untitled for unparseable", () => {
    expect(deriveTitleFromUrl("")).toBe("untitled");
  });
});
