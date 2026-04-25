import { describe, expect, it } from "vitest";
import {
  extractAllowedUrlsFromCommunitySearchJson,
  extractAllowedUrlsFromHnAlgoliaJson,
  extractAllowedRepairUrlsFromDiscovery,
  extractAllowedUrlsFromRedditSearchJson,
  isAllowedOfficialPrimaryRepairHost,
  planSourceCoverageRepair
} from "@/lib/orchestrator/source-coverage-repair";

describe("source coverage repair planner", () => {
  it("triggers when official or primary evidence is absent", () => {
    const plan = planSourceCoverageRepair({
      title: "AI agent memory",
      summary: {
        hasOfficialOrPrimaryEvidence: false
      }
    });

    expect(plan.shouldRun).toBe(true);
    expect(plan.reason).toBe("no_official_or_primary_evidence");
  });

  it("triggers when source coverage warnings include no official or primary evidence", () => {
    const plan = planSourceCoverageRepair({
      title: "AI agent memory",
      summary: {
        sourceCoverageWarnings: ["no_official_or_primary_evidence"]
      }
    });

    expect(plan.shouldRun).toBe(true);
    expect(plan.reason).toBe("no_official_or_primary_evidence");
  });

  it("does not trigger when official or primary evidence exists", () => {
    const plan = planSourceCoverageRepair({
      title: "AI agent memory",
      summary: {
        hasOfficialOrPrimaryEvidence: true,
        sourceCoverageWarnings: ["no_official_or_primary_evidence"]
      }
    });

    expect(plan).toEqual({
      shouldRun: false,
      reason: null,
      discovery: null
    });
  });

  it("emits one discovery query and url", () => {
    const plan = planSourceCoverageRepair({
      title: "False convergence safeguards",
      goal: "prevent source over reliance",
      summary: {
        hasOfficialOrPrimaryEvidence: false
      }
    });

    expect(plan.discovery).not.toBeNull();
    expect(plan.discovery?.url.startsWith("https://s.jina.ai/?q=")).toBe(true);
    expect(plan.discovery?.url.includes("reddit")).toBe(false);
    expect(plan.discovery?.url.includes("hn.algolia")).toBe(false);
    expect(plan.discovery?.query).toBe("False convergence safeguards official documentation");
  });

  it("uses deterministic order and includes repair metadata fields", () => {
    const input = {
      title: "Agent evidence",
      goal: "improve research packet",
      summary: {
        sourceCoverageWarnings: ["no_official_or_primary_evidence"]
      }
    };
    const first = planSourceCoverageRepair(input);
    const second = planSourceCoverageRepair(input);

    expect(first).toEqual(second);
    expect(first.discovery?.repairPass).toBe("source_coverage_v1");
    expect(first.discovery?.repairStage).toBe("discovery");
    expect(first.discovery?.repairReason).toBe("no_official_or_primary_evidence");
  });

  it("extracts allowlisted direct URLs from discovery content", () => {
    const urls = extractAllowedRepairUrlsFromDiscovery({
      content: [
        "https://s.jina.ai/?q=ignore-me",
        "https://openai.com/index/introducing-deep-research/",
        "https://platform.openai.com/docs/guides/reasoning",
        "https://arxiv.org/abs/2501.00001",
        "https://news.ycombinator.com/item?id=1",
        "https://dl.acm.org/doi/10.1145/1234567"
      ].join("\n")
    });

    expect(urls).toEqual([
      "https://openai.com/index/introducing-deep-research/",
      "https://platform.openai.com/docs/guides/reasoning",
      "https://arxiv.org/abs/2501.00001"
    ]);
  });

  it("allows openai and anthropic direct URLs as official evidence hosts", () => {
    expect(isAllowedOfficialPrimaryRepairHost("openai.com")).toBe(true);
    expect(isAllowedOfficialPrimaryRepairHost("platform.openai.com")).toBe(true);
    expect(isAllowedOfficialPrimaryRepairHost("anthropic.com")).toBe(true);
    expect(isAllowedOfficialPrimaryRepairHost("docs.anthropic.com")).toBe(true);
  });

  it("allows arxiv and acm direct URLs as primary evidence hosts", () => {
    expect(isAllowedOfficialPrimaryRepairHost("arxiv.org")).toBe(true);
    expect(isAllowedOfficialPrimaryRepairHost("export.arxiv.org")).toBe(true);
    expect(isAllowedOfficialPrimaryRepairHost("acm.org")).toBe(true);
    expect(isAllowedOfficialPrimaryRepairHost("dl.acm.org")).toBe(true);
  });

  it("rejects jina, reddit, and hn hosts as follow targets", () => {
    expect(isAllowedOfficialPrimaryRepairHost("s.jina.ai")).toBe(false);
    expect(isAllowedOfficialPrimaryRepairHost("r.jina.ai")).toBe(false);
    expect(isAllowedOfficialPrimaryRepairHost("reddit.com")).toBe(false);
    expect(isAllowedOfficialPrimaryRepairHost("news.ycombinator.com")).toBe(false);
  });

  it("dedupes, caps at three, and preserves deterministic ordering", () => {
    const urls = extractAllowedRepairUrlsFromDiscovery({
      content: [
        "https://openai.com/research",
        "https://openai.com/research",
        "https://anthropic.com/research",
        "https://arxiv.org/abs/2501.00001",
        "https://dl.acm.org/doi/10.1145/1234567"
      ].join(" ")
    });

    expect(urls).toEqual([
      "https://openai.com/research",
      "https://anthropic.com/research",
      "https://arxiv.org/abs/2501.00001"
    ]);
  });

  it("parses allowlisted outbound URLs from reddit raw JSON", () => {
    const urls = extractAllowedUrlsFromRedditSearchJson(
      JSON.stringify({
        data: {
          children: [
            { data: { url: "https://openai.com/research/guardrails" } },
            { data: { url: "https://reddit.com/r/test" } },
            { data: { url: "https://platform.openai.com/docs/guides/reasoning" } }
          ]
        }
      })
    );

    expect(urls).toEqual([
      "https://openai.com/research/guardrails",
      "https://platform.openai.com/docs/guides/reasoning"
    ]);
  });

  it("parses allowlisted outbound URLs from hn algolia raw JSON", () => {
    const urls = extractAllowedUrlsFromHnAlgoliaJson(
      JSON.stringify({
        hits: [
          { url: "https://news.ycombinator.com/item?id=1" },
          { url: "https://arxiv.org/abs/2501.00001" },
          { url: "https://dl.acm.org/doi/10.1145/1234567" }
        ]
      })
    );

    expect(urls).toEqual([
      "https://arxiv.org/abs/2501.00001",
      "https://dl.acm.org/doi/10.1145/1234567"
    ]);
  });

  it("returns empty arrays for invalid community search json", () => {
    expect(extractAllowedUrlsFromRedditSearchJson("{bad json")).toEqual([]);
    expect(extractAllowedUrlsFromHnAlgoliaJson("{bad json")).toEqual([]);
    expect(
      extractAllowedUrlsFromCommunitySearchJson({
        rawJson: "{bad json",
      })
    ).toEqual([]);
  });

  it("ignores non-allowlisted and search/community urls as final evidence", () => {
    const urls = extractAllowedUrlsFromCommunitySearchJson({
      rawJson: JSON.stringify({
        hits: [
          { url: "https://hn.algolia.com/api/v1/search?query=test" },
          { url: "https://s.jina.ai/?q=test" },
          { url: "https://news.ycombinator.com/item?id=1" },
          { url: "https://example.com/post" }
        ]
      }),
    });

    expect(urls).toEqual([]);
  });

  it("dispatches by raw json shape, not artifact url, for hn payloads", () => {
    const urls = extractAllowedUrlsFromCommunitySearchJson({
      rawJson: JSON.stringify({
        hits: [
          { url: "https://news.ycombinator.com/item?id=1" },
          { url: "https://openai.com/research/guardrails" }
        ]
      })
    });

    expect(urls).toEqual(["https://openai.com/research/guardrails"]);
  });

  it("dispatches by raw json shape, not artifact url, for reddit payloads", () => {
    const urls = extractAllowedUrlsFromCommunitySearchJson({
      rawJson: JSON.stringify({
        data: {
          children: [
            { data: { url: "https://platform.openai.com/docs/guides/reasoning" } }
          ]
        }
      })
    });

    expect(urls).toEqual(["https://platform.openai.com/docs/guides/reasoning"]);
  });

  it("zero allowlisted candidates produce no follow candidates", () => {
    const urls = extractAllowedUrlsFromCommunitySearchJson({
      rawJson: JSON.stringify({
        hits: [
          { url: "https://news.ycombinator.com/item?id=1" },
          { url: "https://example.com/post" }
        ]
      })
    });

    expect(urls).toEqual([]);
  });
});
