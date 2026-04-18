import { describe, expect, it } from "vitest";
import { inferSourceTier } from "@/lib/adapters/source-tier";

describe("inferSourceTier", () => {
  it("classifies jina search as aggregator", () => {
    expect(inferSourceTier("https://s.jina.ai/?q=test")).toBe("aggregator");
  });

  it("classifies reddit search as community", () => {
    expect(inferSourceTier("https://www.reddit.com/search.json?q=test")).toBe("community");
  });

  it("classifies hn algolia as community", () => {
    expect(inferSourceTier("https://hn.algolia.com/api/v1/search?query=test")).toBe("community");
  });

  it("classifies unknown domains as unknown", () => {
    expect(inferSourceTier("https://random.example.com/page")).toBe("unknown");
  });

  it("returns unknown for malformed urls", () => {
    expect(inferSourceTier("malformed://")).toBe("unknown");
  });

  it("classifies reddit subdomains as community", () => {
    expect(inferSourceTier("https://old.reddit.com/r/foo")).toBe("community");
  });

  it("classifies jina reader as aggregator", () => {
    expect(inferSourceTier("https://r.jina.ai/http://example.com")).toBe("aggregator");
  });
});
