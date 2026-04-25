import { describe, expect, it } from "vitest";
import { planSourceCoverageRepair } from "@/lib/orchestrator/source-coverage-repair";

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
      urls: []
    });
  });

  it("generates at most three official-primary oriented jina search URLs", () => {
    const plan = planSourceCoverageRepair({
      title: "False convergence safeguards",
      goal: "prevent source over reliance",
      summary: {
        hasOfficialOrPrimaryEvidence: false
      }
    });

    expect(plan.urls).toHaveLength(3);
    expect(plan.urls.every((item) => item.url.startsWith("https://s.jina.ai/?q="))).toBe(true);
    expect(plan.urls.some((item) => item.url.includes("reddit"))).toBe(false);
    expect(plan.urls.some((item) => item.url.includes("hn.algolia"))).toBe(false);
    expect(plan.urls[0]?.query).toBe("False convergence safeguards official documentation");
    expect(plan.urls[1]?.query).toBe(
      "False convergence safeguards research paper benchmark report"
    );
    expect(plan.urls[2]?.query).toBe(
      "prevent source over reliance site:openai.com OR site:anthropic.com OR site:arxiv.org OR site:acm.org"
    );
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
    expect(first.urls.map((item) => item.repairAttemptIndex)).toEqual([0, 1, 2]);
    expect(first.urls.every((item) => item.repairPass === "source_coverage_v0")).toBe(true);
    expect(
      first.urls.every((item) => item.repairReason === "no_official_or_primary_evidence")
    ).toBe(true);
  });
});
