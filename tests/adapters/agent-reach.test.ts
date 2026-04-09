import { describe, expect, it } from "vitest";
import { createAgentReachAdapter } from "@/lib/adapters/agent-reach";
import type { ResearchPlan } from "@/lib/orchestrator/plan-run";

const plan: ResearchPlan = {
  projectId: "project-1",
  runId: "run-1",
  title: "숏츠 시장조사",
  mode: "standard",
  normalizedInput: {
    title: "숏츠 시장조사",
    naturalLanguage:
      "목표: 숏츠 시장 진입 판단\n대상: 20대 크리에이터\n비교: 쇼츠 vs 릴스",
    pastedContent: "",
    urls: ["https://example.com/post"],
    goal: "숏츠 시장 진입 판단",
    target: "20대 크리에이터",
    comparisonAxis: "쇼츠 vs 릴스"
  },
  sourceTargets: ["web", "community", "video", "github"]
};

describe("agent reach adapter", () => {
  it("supports plans that include its source targets", () => {
    const adapter = createAgentReachAdapter();
    expect(adapter.supports(plan)).toBe(true);
  });

  it("converts executor output into source artifacts", async () => {
    const adapter = createAgentReachAdapter({
      exec: async (command, args) => {
        expect(command).toContain("python");
        expect(args.join(" ")).toContain("숏츠 시장조사");

        return {
          stdout: JSON.stringify({
            items: [
              {
                sourceType: "web",
                title: "시장 조사 글",
                url: "https://example.com/post",
                snippet: "요약"
              }
            ]
          }),
          stderr: "",
          exitCode: 0
        };
      }
    });

    const artifacts = await adapter.execute(plan);

    expect(artifacts).toEqual([
      {
        id: "agent-reach-0",
        adapter: "agent-reach",
        sourceType: "web",
        title: "시장 조사 글",
        url: "https://example.com/post",
        snippet: "요약",
        content: "",
        sourcePriority: "analysis",
        metadata: {}
      }
    ]);
  });
});
