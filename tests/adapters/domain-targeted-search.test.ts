import { describe, expect, it, vi } from "vitest";

import {
  buildDomainTargetedSearchUrl,
  discoverDomainTargetedCandidates,
  parseDomainTargetedSearchHtml
} from "@/lib/adapters/domain-targeted-search";

describe("buildDomainTargetedSearchUrl()", () => {
  it("builds a duckduckgo html search url scoped to allowed domains", () => {
    const url = buildDomainTargetedSearchUrl("agent safeguards");
    expect(url).toContain("html.duckduckgo.com/html/");
    expect(url).toContain("site%3Aopenai.com");
    expect(url).toContain("site%3Aanthropic.com");
    expect(url).toContain("site%3Aarxiv.org");
    expect(url).toContain("site%3Aacm.org");
  });
});

describe("parseDomainTargetedSearchHtml()", () => {
  it("extracts direct allowed urls and assigns host classes", () => {
    const html = `
      <div class="result">
        <a href="https://openai.com/research/safeguards">OpenAI safeguards</a>
      </div>
      <div class="result">
        <a href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://docs.anthropic.com/en/docs/test-and-evaluate/strengthen-guardrails")}">Anthropic docs</a>
      </div>
      <div class="result">
        <a href="/l/?uddg=${encodeURIComponent("https://arxiv.org/abs/2501.00001")}">arXiv paper</a>
      </div>
      <div class="result">
        <a href="https://dl.acm.org/doi/10.1145/1234567">ACM paper</a>
      </div>
    `;

    const result = parseDomainTargetedSearchHtml("query", html);

    expect(result.rawResultCount).toBe(4);
    expect(result.allowedResultCount).toBe(4);
    expect(result.candidates).toEqual([
      {
        url: "https://openai.com/research/safeguards",
        title: "OpenAI safeguards",
        hostClass: "official"
      },
      {
        url: "https://docs.anthropic.com/en/docs/test-and-evaluate/strengthen-guardrails",
        title: "Anthropic docs",
        hostClass: "official"
      },
      {
        url: "https://arxiv.org/abs/2501.00001",
        title: "arXiv paper",
        hostClass: "primary"
      },
      {
        url: "https://dl.acm.org/doi/10.1145/1234567",
        title: "ACM paper",
        hostClass: "primary"
      }
    ]);
    expect(result.errors).toEqual([]);
  });

  it("rejects non-allowlisted and aggregator/community hosts", () => {
    const html = `
      <a href="https://example.com/post">Example</a>
      <a href="https://s.jina.ai/?q=test">Jina</a>
      <a href="https://r.jina.ai/http://example.com">Jina reader</a>
      <a href="https://reddit.com/r/test/comments/1">Reddit</a>
      <a href="https://news.ycombinator.com/item?id=1">HN item</a>
      <a href="https://hn.algolia.com/api/v1/search?query=test">HN search</a>
      <a href="https://openai.com/index/openai-for-business/">OpenAI allowed</a>
    `;

    const result = parseDomainTargetedSearchHtml("query", html);

    expect(result.rawResultCount).toBe(7);
    expect(result.allowedResultCount).toBe(1);
    expect(result.candidates.map((candidate) => candidate.url)).toEqual([
      "https://openai.com/index/openai-for-business/"
    ]);
  });

  it("dedupes urls and caps results at 5 in deterministic order", () => {
    const urls = [
      "https://openai.com/a",
      "https://openai.com/a",
      "https://anthropic.com/b",
      "https://arxiv.org/abs/1",
      "https://acm.org/c",
      "https://platform.openai.com/d",
      "https://openai.com/e"
    ];
    const html = urls
      .map((url, index) => `<a href="${url}">result ${index}</a>`)
      .join("\n");

    const result = parseDomainTargetedSearchHtml("query", html);

    expect(result.allowedResultCount).toBe(5);
    expect(result.candidates.map((candidate) => candidate.url)).toEqual([
      "https://openai.com/a",
      "https://anthropic.com/b",
      "https://arxiv.org/abs/1",
      "https://acm.org/c",
      "https://platform.openai.com/d"
    ]);
  });

  it("returns a sanitized error for malformed or empty html", () => {
    const result = parseDomainTargetedSearchHtml("query", "<html><body>oops</body></html>");

    expect(result.candidates).toEqual([]);
    expect(result.allowedResultCount).toBe(0);
    expect(result.errors).toEqual(["no_result_links_found"]);
  });
});

describe("discoverDomainTargetedCandidates()", () => {
  it("uses mocked fetch and never returns raw html", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        `<a href="https://openai.com/research/safety">OpenAI safety</a>`
    }));

    const result = await discoverDomainTargetedCandidates("query", { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.candidates).toEqual([
      {
        url: "https://openai.com/research/safety",
        title: "OpenAI safety",
        hostClass: "official"
      }
    ]);
    expect("html" in (result as unknown as Record<string, unknown>)).toBe(false);
  });

  it("returns empty candidates and sanitized error on network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("socket hang up");
    });

    const result = await discoverDomainTargetedCandidates("query", { fetchImpl });

    expect(result.candidates).toEqual([]);
    expect(result.errors).toEqual(["fetch_failed"]);
  });
});
