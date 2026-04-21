import { describe, expect, it } from "vitest";
import { expandQuery } from "@/lib/orchestrator/query-expansion";

describe("expandQuery", () => {
  it("builds default official and recent expansions", () => {
    const result = expandQuery(
      {
        title: "OpenAI pricing",
        naturalLanguage: "",
        pastedContent: "",
        urls: [],
        goal: "비용 분석",
        target: "",
        comparisonAxis: ""
      },
      {
        now: new Date("2026-04-18T00:00:00.000Z")
      }
    );

    expect(result).toMatchInlineSnapshot(`
      {
        "dropped": 0,
        "expanded": [
          {
            "axis": "official",
            "query": "OpenAI pricing",
            "source": "jina-search",
            "url": "https://s.jina.ai/?q=OpenAI+pricing",
          },
          {
            "axis": "official",
            "query": "OpenAI pricing",
            "source": "reddit-search",
            "url": "https://www.reddit.com/search.json?q=OpenAI+pricing&limit=25",
          },
          {
            "axis": "official",
            "query": "OpenAI pricing",
            "source": "hn-algolia",
            "url": "https://hn.algolia.com/api/v1/search?query=OpenAI+pricing&hitsPerPage=20",
          },
          {
            "axis": "recent",
            "query": "OpenAI pricing after:2025",
            "source": "jina-search",
            "url": "https://s.jina.ai/?q=OpenAI+pricing+after%3A2025",
          },
          {
            "axis": "recent",
            "query": "OpenAI pricing",
            "source": "reddit-search",
            "url": "https://www.reddit.com/search.json?q=OpenAI+pricing&limit=25&t=year&sort=new",
          },
          {
            "axis": "recent",
            "query": "OpenAI pricing",
            "source": "hn-algolia",
            "url": "https://hn.algolia.com/api/v1/search?query=OpenAI+pricing&hitsPerPage=20&numericFilters=created_at_i%3E1744934400",
          },
        ],
      }
    `);
  });

  it("expands comparison tokens from comma-separated axis", () => {
    const result = expandQuery(
      {
        title: "OpenAI pricing",
        naturalLanguage: "",
        pastedContent: "",
        urls: [],
        goal: "",
        target: "",
        comparisonAxis: "Anthropic, Google"
      },
      {
        sources: ["jina-search"],
        now: new Date("2026-04-18T00:00:00.000Z")
      }
    );

    expect(result.expanded.filter((entry) => entry.axis === "comparison")).toEqual([
      {
        axis: "comparison",
        query: "OpenAI pricing vs Anthropic",
        source: "jina-search",
        url: "https://s.jina.ai/?q=OpenAI+pricing+vs+Anthropic"
      },
      {
        axis: "comparison",
        query: "OpenAI pricing vs Google",
        source: "jina-search",
        url: "https://s.jina.ai/?q=OpenAI+pricing+vs+Google"
      }
    ]);
  });

  it("infers comparison expansion from a title-level vs query when comparisonAxis is empty", () => {
    const result = expandQuery(
      {
        title: "TypeScript monolith vs microservices — 팀 생산성 판단",
        naturalLanguage: "",
        pastedContent: "",
        urls: [],
        goal: "",
        target: "",
        comparisonAxis: ""
      },
      {
        sources: ["jina-search"],
        now: new Date("2026-04-18T00:00:00.000Z")
      }
    );

    expect(result.expanded.filter((entry) => entry.axis === "comparison")).toEqual([
      {
        axis: "comparison",
        query: "TypeScript monolith vs microservices",
        source: "jina-search",
        url: "https://s.jina.ai/?q=TypeScript+monolith+vs+microservices"
      }
    ]);
  });

  it("infers comparison expansion from Korean-English mixed titles", () => {
    const result = expandQuery(
      {
        title: "React Server Components vs SPA — 실전 도입 후회",
        naturalLanguage: "",
        pastedContent: "",
        urls: [],
        goal: "",
        target: "",
        comparisonAxis: ""
      },
      {
        sources: ["reddit-search"],
        now: new Date("2026-04-18T00:00:00.000Z")
      }
    );

    expect(result.expanded.filter((entry) => entry.axis === "comparison")).toEqual([
      {
        axis: "comparison",
        query: "React Server Components vs SPA",
        source: "reddit-search",
        url: "https://www.reddit.com/search.json?q=React+Server+Components+vs+SPA&limit=25"
      }
    ]);
  });

  it("prefers inferred title comparison over comparisonAxis tokens when the title is already comparative", () => {
    const result = expandQuery(
      {
        title: "TypeScript monolith vs microservices — 팀 생산성 판단",
        naturalLanguage: "",
        pastedContent: "",
        urls: [],
        goal: "",
        target: "",
        comparisonAxis: "monolith, microservices"
      },
      {
        sources: ["reddit-search"],
        now: new Date("2026-04-18T00:00:00.000Z")
      }
    );

    expect(result.expanded.filter((entry) => entry.axis === "comparison")).toEqual([
      {
        axis: "comparison",
        query: "TypeScript monolith vs microservices",
        source: "reddit-search",
        url: "https://www.reddit.com/search.json?q=TypeScript+monolith+vs+microservices&limit=25"
      }
    ]);
  });

  it("includes counter axis only when explicitly requested", () => {
    const result = expandQuery(
      {
        title: "OpenAI pricing",
        naturalLanguage: "",
        pastedContent: "",
        urls: [],
        goal: "",
        target: "",
        comparisonAxis: ""
      },
      {
        axes: ["counter"],
        sources: ["jina-search"],
        now: new Date("2026-04-18T00:00:00.000Z")
      }
    );

    expect(result.expanded).toEqual([
      {
        axis: "counter",
        query: "OpenAI pricing problems OR issues OR drawbacks OR 단점 OR 문제",
        source: "jina-search",
        url: "https://s.jina.ai/?q=OpenAI+pricing+problems+OR+issues+OR+drawbacks+OR+%EB%8B%A8%EC%A0%90+OR+%EB%AC%B8%EC%A0%9C"
      }
    ]);
  });

  it("drops all expanded urls when input urls already fill the cap", () => {
    const result = expandQuery(
      {
        title: "OpenAI pricing",
        naturalLanguage: "",
        pastedContent: "",
        urls: ["https://example.com/a", "https://example.com/b"],
        goal: "",
        target: "",
        comparisonAxis: ""
      },
      {
        maxUrlsPerRun: 2,
        now: new Date("2026-04-18T00:00:00.000Z")
      }
    );

    expect(result.expanded).toEqual([]);
    expect(result.dropped).toBeGreaterThan(0);
  });

  it("deduplicates duplicate urls", () => {
    const result = expandQuery(
      {
        title: "OpenAI pricing",
        naturalLanguage: "",
        pastedContent: "",
        urls: [],
        goal: "",
        target: "",
        comparisonAxis: ""
      },
      {
        axes: ["official", "official"],
        sources: ["jina-search"],
        now: new Date("2026-04-18T00:00:00.000Z")
      }
    );

    expect(result.expanded).toHaveLength(1);
    expect(result.dropped).toBe(0);
  });

  it("limits comparison tokens conservatively and respects explicit tokens", () => {
    const splitResult = expandQuery(
      {
        title: "OpenAI pricing",
        naturalLanguage: "",
        pastedContent: "",
        urls: [],
        goal: "",
        target: "",
        comparisonAxis: "A vs B / C"
      },
      {
        sources: ["jina-search"],
        now: new Date("2026-04-18T00:00:00.000Z")
      }
    );

    expect(splitResult.expanded.filter((entry) => entry.axis === "comparison")).toEqual([
      {
        axis: "comparison",
        query: "OpenAI pricing vs A vs B / C",
        source: "jina-search",
        url: "https://s.jina.ai/?q=OpenAI+pricing+vs+A+vs+B+%2F+C"
      }
    ]);

    const cappedResult = expandQuery(
      {
        title: "OpenAI pricing",
        naturalLanguage: "",
        pastedContent: "",
        urls: [],
        goal: "",
        target: "",
        comparisonAxis: "A, B, C, D"
      },
      {
        sources: ["jina-search"],
        maxComparisonTokens: 3,
        now: new Date("2026-04-18T00:00:00.000Z")
      }
    );

    expect(cappedResult.expanded.filter((entry) => entry.axis === "comparison")).toHaveLength(3);

    const explicitResult = expandQuery(
      {
        title: "OpenAI pricing",
        naturalLanguage: "",
        pastedContent: "",
        urls: [],
        goal: "",
        target: "",
        comparisonAxis: "ignored"
      },
      {
        comparisonTokens: ["X", "Y"],
        sources: ["jina-search"],
        now: new Date("2026-04-18T00:00:00.000Z")
      }
    );

    expect(explicitResult.expanded.filter((entry) => entry.axis === "comparison")).toEqual([
      {
        axis: "comparison",
        query: "OpenAI pricing vs X",
        source: "jina-search",
        url: "https://s.jina.ai/?q=OpenAI+pricing+vs+X"
      },
      {
        axis: "comparison",
        query: "OpenAI pricing vs Y",
        source: "jina-search",
        url: "https://s.jina.ai/?q=OpenAI+pricing+vs+Y"
      }
    ]);
  });

  it("returns empty expansion for blank input", () => {
    const result = expandQuery(
      {
        title: "",
        naturalLanguage: "",
        pastedContent: "",
        urls: [],
        goal: "",
        target: "",
        comparisonAxis: ""
      },
      {
        now: new Date("2026-04-18T00:00:00.000Z")
      }
    );

    expect(result).toEqual({
      expanded: [],
      dropped: 0
    });
  });
});
