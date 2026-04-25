import { describe, expect, it } from "vitest";
import { inferSourceTier } from "@/lib/adapters/source-tier";

describe("inferSourceTier", () => {
  it("classifies jina search as aggregator", () => {
    expect(inferSourceTier("https://s.jina.ai/?q=test")).toBe("aggregator");
  });

  it("classifies openai.com as official", () => {
    expect(inferSourceTier("https://openai.com/research")).toBe("official");
  });

  it("classifies openai subdomains as official", () => {
    expect(inferSourceTier("https://platform.openai.com/docs")).toBe("official");
  });

  it("classifies anthropic.com as official", () => {
    expect(inferSourceTier("https://anthropic.com/news")).toBe("official");
  });

  it("classifies anthropic subdomains as official", () => {
    expect(inferSourceTier("https://docs.anthropic.com/en/docs")).toBe("official");
  });

  it("classifies arxiv.org as primary", () => {
    expect(inferSourceTier("https://arxiv.org/abs/2501.00001")).toBe("primary");
  });

  it("classifies arxiv subdomains as primary", () => {
    expect(inferSourceTier("https://export.arxiv.org/api/query")).toBe("primary");
  });

  it("classifies acm.org as primary", () => {
    expect(inferSourceTier("https://acm.org/publications")).toBe("primary");
  });

  it("classifies acm subdomains as primary", () => {
    expect(inferSourceTier("https://dl.acm.org/doi/10.1145/1234567")).toBe("primary");
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

  it("classifies kb.local as internal", () => {
    expect(inferSourceTier("https://kb.local/wiki/some-id")).toBe("internal");
  });

  it("classifies kb.local with arbitrary path and query as internal", () => {
    expect(inferSourceTier("https://kb.local/anything?x=1")).toBe("internal");
  });
});
