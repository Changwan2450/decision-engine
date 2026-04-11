import type { ResearchAdapter, SourceArtifact } from "@/lib/adapters/types";

type ReclipExtraction = {
  title: string;
  platform?: string;
  url: string;
  transcript?: string;
  text?: string;
  author?: string;
  duration?: number;
  publishedAt?: string;
};

type ReclipExtractor = (url: string) => Promise<ReclipExtraction | null>;

const VIDEO_URL_PATTERN =
  /(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com\/reel|instagram\.com\/p\/|x\.com|twitter\.com|reddit\.com\/r\/|vimeo\.com|loom\.com|streamable\.com)/i;

function isVideoLikeUrl(url: string): boolean {
  return VIDEO_URL_PATTERN.test(url);
}

function defaultSnippet(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, 240);
}

function normalizeArtifact(extraction: ReclipExtraction, index: number): SourceArtifact | null {
  const body = extraction.transcript?.trim() || extraction.text?.trim() || "";

  if (!body) {
    return null;
  }

  return {
    id: `reclip-${index}`,
    adapter: "reclip",
    sourceType: "video",
    title: extraction.title,
    url: extraction.url,
    snippet: defaultSnippet(body),
    content: body,
    sourcePriority: "analysis",
    publishedAt: extraction.publishedAt,
    metadata: {
      ...(extraction.author ? { author: extraction.author } : {}),
      ...(typeof extraction.duration === "number"
        ? { duration: String(extraction.duration) }
        : {}),
      ...(extraction.platform ? { platform: extraction.platform } : {}),
      source_label: "video/reclip"
    }
  };
}

export function createReclipAdapter(deps?: {
  extract?: ReclipExtractor;
}): ResearchAdapter {
  const extract = deps?.extract ?? (async () => null);

  return {
    name: "reclip",
    supports(plan) {
      return (
        plan.sourceTargets.includes("video") &&
        plan.normalizedInput.urls.some((url) => isVideoLikeUrl(url))
      );
    },
    async execute(plan) {
      const videoUrls = plan.normalizedInput.urls.filter((url) => isVideoLikeUrl(url));

      try {
        const results = await Promise.all(videoUrls.map((url) => extract(url)));
        return results
          .map((result, index) => (result ? normalizeArtifact(result, index) : null))
          .filter((artifact): artifact is SourceArtifact => artifact !== null);
      } catch (error) {
        console.error("Reclip adapter failed", error);
        return [];
      }
    }
  };
}
