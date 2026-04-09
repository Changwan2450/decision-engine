import type { ResearchPlan, SourceArtifact } from "@/lib/adapters/types";

export async function gatherE2EArtifacts(
  plan: ResearchPlan
): Promise<SourceArtifact[]> {
  return [
    {
      id: "fixture-artifact-0",
      adapter: "agent-reach",
      sourceType: "web",
      title: `${plan.title} fixture`,
      url: "https://example.com/e2e-fixture",
      snippet: "시장 성장과 경쟁사 움직임 요약",
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
            text: "Competitor automation is increasing.",
            topicKey: "competitor-automation",
            stance: "support"
          }
        ]),
        repeated_problem: "차별화가 어렵다",
        repeated_pattern: "짧은 반복 루프로 retention을 높인다",
        competitor_signal: "릴스가 편집 자동화를 밀고 있다"
      }
    }
  ];
}
