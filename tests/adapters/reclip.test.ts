import { describe, expect, it } from "vitest";
import { createReclipAdapter } from "@/lib/adapters/reclip";
import type { ResearchPlan } from "@/lib/orchestrator/plan-run";

const videoPlan: ResearchPlan = {
  projectId: "project-1",
  runId: "run-1",
  title: "유튜브 쇼츠 조사",
  mode: "standard",
  normalizedInput: {
    title: "유튜브 쇼츠 조사",
    naturalLanguage: "유튜브 쇼츠를 조사한다",
    pastedContent: "",
    urls: ["https://www.youtube.com/watch?v=abc123xyz00"]
  },
  sourceTargets: ["web", "community", "video"],
  kbContext: null
};

describe("reclip adapter", () => {
  it("supports only video-like inputs", () => {
    const adapter = createReclipAdapter();

    expect(adapter.supports(videoPlan)).toBe(true);
    expect(
      adapter.supports({
        ...videoPlan,
        normalizedInput: {
          ...videoPlan.normalizedInput,
          urls: ["https://example.com/article"]
        }
      })
    ).toBe(false);
  });

  it("returns normalized artifact with transcript text and metadata", async () => {
    const adapter = createReclipAdapter({
      extract: async () => ({
        title: "Video title",
        platform: "youtube",
        url: "https://www.youtube.com/watch?v=abc123xyz00",
        transcript:
          "This is the first transcript line. This is the second transcript line.",
        author: "Creator",
        duration: 95,
        publishedAt: "2026-04-09T00:00:00.000Z"
      })
    });

    const artifacts = await adapter.execute(videoPlan);

    expect(artifacts).toEqual([
      {
        id: "reclip-0",
        adapter: "reclip",
        sourceType: "video",
        title: "Video title",
        url: "https://www.youtube.com/watch?v=abc123xyz00",
        snippet: "This is the first transcript line. This is the second transcript line.",
        content: "This is the first transcript line. This is the second transcript line.",
        sourcePriority: "analysis",
        publishedAt: "2026-04-09T00:00:00.000Z",
        metadata: {
          author: "Creator",
          duration: "95",
          platform: "youtube",
          source_label: "video/reclip"
        }
      }
    ]);
  });

  it("returns an empty array when extraction fails", async () => {
    const adapter = createReclipAdapter({
      extract: async () => {
        throw new Error("reclip unavailable");
      }
    });

    await expect(adapter.execute(videoPlan)).resolves.toEqual([]);
  });
});
