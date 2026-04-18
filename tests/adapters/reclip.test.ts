import { describe, expect, it } from "vitest";

import { assertMetadataContract } from "@/lib/adapters/contract";
import { createReclipAdapter } from "@/lib/adapters/reclip";
import type { ResearchPlan } from "@/lib/orchestrator/plan-run";

const FIXED_NOW = "2026-04-18T00:00:00.000Z";

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

  it("returns normalized artifact from subtitles with full metadata contract", async () => {
    const adapter = createReclipAdapter({
      now: () => FIXED_NOW,
      exec: async () => ({
        stdout: JSON.stringify({
          title: "Video title",
          webpage_url: "https://www.youtube.com/watch?v=abc123xyz00",
          extractor_key: "Youtube",
          uploader: "Creator",
          duration: 95,
          timestamp: 1775692800,
          automatic_captions: {
            en: [{ ext: "vtt", url: "https://example.com/subs.vtt" }]
          }
        }),
        stderr: "",
        exitCode: 0
      }),
      fetchText: async (url) => {
        expect(url).toBe("https://example.com/subs.vtt");
        return [
          "WEBVTT",
          "",
          "00:00:00.000 --> 00:00:02.000",
          "First transcript line",
          "",
          "00:00:02.000 --> 00:00:04.000",
          "Second transcript line"
        ].join("\n");
      },
      normalize: async ({ format, payload }) => {
        expect(format).toBe("text");
        expect(String(payload)).toContain("First transcript line");
        return String(payload);
      },
      storeRaw: async () => "project-1/runs/run-1/raw/reclip/info.json"
    });

    const [artifact] = await adapter.execute(videoPlan);

    expect(artifact.id).toBe("reclip-0");
    expect(artifact.adapter).toBe("reclip");
    expect(artifact.sourceType).toBe("video");
    expect(artifact.title).toBe("Video title");
    expect(artifact.url).toBe("https://www.youtube.com/watch?v=abc123xyz00");
    expect(artifact.canonicalUrl).toBe("https://www.youtube.com/watch?v=abc123xyz00");
    expect(artifact.content).toContain("First transcript line");
    expect(artifact.snippet).toContain("First transcript line");
    expect(artifact.retrievedAt).toBe(FIXED_NOW);
    expect(artifact.publishedAt).toBe("2026-04-09T00:00:00.000Z");
    expect(artifact.rawRef).toBe("project-1/runs/run-1/raw/reclip/info.json");
    expect(artifact.metadata.fetcher).toBe("reclip");
    expect(artifact.metadata.fetch_status).toBe("success");
    expect(artifact.metadata.platform).toBe("youtube");
    expect(artifact.metadata.author).toBe("Creator");
    expect(artifact.metadata.duration).toBe("95");
    expect(artifact.metadata.transcript_source).toBe("vtt");
    expect(artifact.metadata.transcript_language).toBe("en");
    assertMetadataContract(artifact.metadata);
  });

  it("falls back to description when subtitles are unavailable", async () => {
    const adapter = createReclipAdapter({
      now: () => FIXED_NOW,
      exec: async () => ({
        stdout: JSON.stringify({
          title: "Clip title",
          webpage_url: "https://www.tiktok.com/@user/video/1",
          extractor_key: "TikTok",
          description: "Description fallback body"
        }),
        stderr: "",
        exitCode: 0
      }),
      normalize: async ({ payload }) => String(payload),
      storeRaw: async () => "project-1/runs/run-1/raw/reclip/info.json"
    });

    const [artifact] = await adapter.execute({
      ...videoPlan,
      normalizedInput: {
        ...videoPlan.normalizedInput,
        urls: ["https://www.tiktok.com/@user/video/1"]
      }
    });

    expect(artifact.metadata.fetch_status).toBe("success");
    expect(artifact.content).toBe("Description fallback body");
    expect(artifact.metadata.platform).toBe("tiktok");
    assertMetadataContract(artifact.metadata);
  });

  it("maps login/cookie failures to blocked artifacts", async () => {
    const adapter = createReclipAdapter({
      now: () => FIXED_NOW,
      exec: async () => ({
        stdout: "",
        stderr: "ERROR: Sign in to confirm your age. Use --cookies",
        exitCode: 1
      })
    });

    const [artifact] = await adapter.execute(videoPlan);
    expect(artifact.metadata.fetch_status).toBe("blocked");
    expect(artifact.metadata.block_reason).toBe("login");
    expect(artifact.metadata.login_required).toBe("true");
    assertMetadataContract(artifact.metadata);
  });

  it("absorbs executor exceptions into error artifacts", async () => {
    const adapter = createReclipAdapter({
      now: () => FIXED_NOW,
      exec: async () => {
        throw new Error("ENOENT yt-dlp");
      }
    });

    const [artifact] = await adapter.execute(videoPlan);
    expect(artifact.metadata.fetch_status).toBe("error");
    expect(artifact.metadata.error).toContain("ENOENT");
    assertMetadataContract(artifact.metadata);
  });
});
