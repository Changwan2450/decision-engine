import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  buildArtifact,
  buildFailureArtifact,
  truncateErrorMessage
} from "@/lib/adapters/contract";
import { canonicalize } from "@/lib/adapters/url";
import type { ArtifactLanguage, ResearchAdapter, ResearchPlan, SourceArtifact } from "@/lib/adapters/types";
import { normalizeToMarkdown } from "@/lib/normalize/markitdown";
import { storeRawPayload } from "@/lib/normalize/raw-store";

const execFileAsync = promisify(execFile);

type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
};

type SubtitleEntry = {
  ext?: string;
  url?: string;
};

type SubtitleMap = Record<string, SubtitleEntry[] | undefined>;

type ReclipInfo = {
  title?: string;
  webpage_url?: string;
  extractor_key?: string;
  description?: string;
  uploader?: string;
  duration?: number;
  timestamp?: number;
  upload_date?: string;
  subtitles?: SubtitleMap;
  automatic_captions?: SubtitleMap;
};

type ReclipExecutor = (command: string, args: string[]) => Promise<ExecResult>;
type FetchText = (url: string) => Promise<string>;

const ADAPTER_NAME = "reclip";
const FETCHER_NAME = "reclip";

const VIDEO_URL_PATTERN =
  /(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com\/reel|instagram\.com\/p\/|x\.com|twitter\.com|reddit\.com\/r\/|vimeo\.com|loom\.com|streamable\.com|bilibili\.com|b23\.tv)/i;

const PREFERRED_SUBTITLE_LANGS = [
  "ko",
  "ko-kr",
  "en",
  "en-us",
  "en-orig",
  "en-GB"
];

function defaultExecutor(command: string, args: string[]): Promise<ExecResult> {
  return execFileAsync(command, args).then(
    (result) => ({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0
    }),
    (error: NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
      signal?: string;
    }) => ({
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
      exitCode: typeof error.code === "number" ? error.code : 1,
      timedOut: error.killed === true && error.signal === "SIGTERM"
    })
  );
}

async function defaultFetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "DecisionEngine/1.0 reclip" }
  });
  if (!response.ok) {
    throw new Error(`subtitle fetch failed: ${response.status}`);
  }
  return response.text();
}

function isVideoLikeUrl(url: string): boolean {
  return VIDEO_URL_PATTERN.test(url);
}

function defaultSnippet(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, 240);
}

function platformFromInfo(info: ReclipInfo, url: string): string | undefined {
  const source = `${info.extractor_key ?? ""} ${url}`.toLowerCase();
  if (source.includes("youtube") || source.includes("youtu.be")) return "youtube";
  if (source.includes("tiktok")) return "tiktok";
  if (source.includes("instagram")) return "instagram";
  if (source.includes("twitter") || source.includes("x.com")) return "x";
  if (source.includes("reddit")) return "reddit";
  if (source.includes("vimeo")) return "vimeo";
  if (source.includes("loom")) return "loom";
  if (source.includes("streamable")) return "streamable";
  if (source.includes("bilibili") || source.includes("b23.tv")) return "bilibili";
  return undefined;
}

function coerceLanguage(language: string | undefined): ArtifactLanguage | undefined {
  switch (language) {
    case "ko":
    case "en":
    case "zh":
    case "ja":
    case "unknown":
      return language;
    default:
      return undefined;
  }
}

function publishedAtFromInfo(info: ReclipInfo): string | undefined {
  if (typeof info.timestamp === "number") {
    return new Date(info.timestamp * 1000).toISOString();
  }
  if (typeof info.upload_date === "string" && /^\d{8}$/.test(info.upload_date)) {
    const year = info.upload_date.slice(0, 4);
    const month = info.upload_date.slice(4, 6);
    const day = info.upload_date.slice(6, 8);
    return new Date(`${year}-${month}-${day}T00:00:00.000Z`).toISOString();
  }
  return undefined;
}

function chooseSubtitleCandidate(
  subtitles: SubtitleMap | undefined,
  automaticCaptions: SubtitleMap | undefined
): { language?: string; url: string; ext?: string } | null {
  const groups = [subtitles, automaticCaptions];
  for (const group of groups) {
    if (!group) continue;
    for (const preferred of PREFERRED_SUBTITLE_LANGS) {
      const entries = group[preferred] ?? group[preferred.toLowerCase()];
      const candidate = entries?.find((entry) => typeof entry?.url === "string");
      if (candidate?.url) {
        return { language: preferred.split("-")[0], url: candidate.url, ext: candidate.ext };
      }
    }

    for (const [language, entries] of Object.entries(group)) {
      if (language.toLowerCase().includes("live_chat")) continue;
      const candidate = entries?.find((entry) => typeof entry?.url === "string");
      if (candidate?.url) {
        return { language: language.split("-")[0].toLowerCase(), url: candidate.url, ext: candidate.ext };
      }
    }
  }

  return null;
}

function stripSubtitleMarkup(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^WEBVTT.*$/gim, "")
    .replace(/^\d+\s*$/gim, "")
    .replace(
      /^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}.*$/gim,
      ""
    )
    .replace(
      /^\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}\.\d{3}.*$/gim,
      ""
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function subtitleTextFromJson3(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      events?: Array<{ segs?: Array<{ utf8?: string }> }>;
    };
    const text = (parsed.events ?? [])
      .flatMap((event) => event.segs ?? [])
      .map((segment) => segment.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    return text;
  } catch {
    return "";
  }
}

function classifyFailure(stderr: string): {
  status: "blocked" | "timeout" | "error";
  blockReason: "login" | "ratelimit" | "unknown";
  loginRequired: boolean;
} {
  const lower = stderr.toLowerCase();
  if (lower.includes("429") || lower.includes("rate limit")) {
    return { status: "blocked", blockReason: "ratelimit", loginRequired: false };
  }
  if (
    lower.includes("sign in") ||
    lower.includes("login") ||
    lower.includes("cookies") ||
    lower.includes("403") ||
    lower.includes("401")
  ) {
    return { status: "blocked", blockReason: "login", loginRequired: true };
  }
  return { status: "error", blockReason: "unknown", loginRequired: false };
}

async function infoToArtifact(
  info: ReclipInfo,
  index: number,
  retrievedAt: string,
  plan: Pick<ResearchPlan, "projectId" | "runId">,
  deps: {
    fetchText: FetchText;
    normalize: typeof normalizeToMarkdown;
    storeRaw: typeof storeRawPayload;
  }
): Promise<SourceArtifact> {
  const rawRef = await deps.storeRaw({
    projectId: plan.projectId,
    runId: plan.runId,
    adapter: ADAPTER_NAME,
    format: "json",
    payload: JSON.stringify(info)
  });

  const chosenUrl = info.webpage_url ?? "";
  const subtitle = chooseSubtitleCandidate(info.subtitles, info.automatic_captions);
  let body = "";
  let language = coerceLanguage(subtitle?.language);

  if (subtitle?.url) {
    const rawSubtitle = await deps.fetchText(subtitle.url);
    body =
      subtitle.ext === "json3"
        ? subtitleTextFromJson3(rawSubtitle)
        : stripSubtitleMarkup(rawSubtitle);
  }

  if (!body) {
    body = (info.description ?? "").trim();
  }

  const content = body
    ? await deps.normalize({
        format: "text",
        payload: body
      })
    : "";

  if (!language && content) {
    language = "unknown";
  }

  if (!content) {
    return buildFailureArtifact({
      id: `${ADAPTER_NAME}-${index}`,
      adapter: ADAPTER_NAME,
      fetcher: FETCHER_NAME,
      url: chosenUrl,
      sourceType: "video",
      outcome: {
        status: "partial",
        blockReason: "unknown",
        bypassLevel: "none",
        loginRequired: false
      },
      errorMessage: "reclip metadata retrieved but no transcript or description available",
      sourceLabel: "video/partial",
      retrievedAt
    });
  }

  return buildArtifact({
    id: `${ADAPTER_NAME}-${index}`,
    adapter: ADAPTER_NAME,
    fetcher: FETCHER_NAME,
    sourceType: "video",
    url: chosenUrl,
    canonicalUrl: canonicalize(chosenUrl) || undefined,
    title: info.title ?? chosenUrl,
    snippet: defaultSnippet(content),
    content,
    sourcePriority: "analysis",
    retrievedAt,
    publishedAt: publishedAtFromInfo(info),
    language,
    rawRef,
    outcome: {
      status: "success",
      blockReason: "unknown",
      bypassLevel: "none",
      loginRequired: false
    },
    sourceLabel: "video/reclip",
    rateLimitBucket: "video/reclip",
    extra: {
      ...(info.uploader ? { author: info.uploader } : {}),
      ...(typeof info.duration === "number" ? { duration: String(info.duration) } : {}),
      ...(platformFromInfo(info, chosenUrl) ? { platform: platformFromInfo(info, chosenUrl) } : {}),
      ...(subtitle?.url ? { transcript_source: subtitle.ext ?? "subtitle" } : {}),
      transcript_language: language ?? "unknown"
    }
  });
}

export function createReclipAdapter(deps?: {
  exec?: ReclipExecutor;
  fetchText?: FetchText;
  now?: () => string;
  normalize?: typeof normalizeToMarkdown;
  storeRaw?: typeof storeRawPayload;
}): ResearchAdapter {
  const exec = deps?.exec ?? defaultExecutor;
  const fetchText = deps?.fetchText ?? defaultFetchText;
  const now = deps?.now ?? (() => new Date().toISOString());
  const normalize = deps?.normalize ?? normalizeToMarkdown;
  const storeRaw = deps?.storeRaw ?? storeRawPayload;

  return {
    name: ADAPTER_NAME,
    supports(plan) {
      return (
        plan.sourceTargets.includes("video") &&
        plan.normalizedInput.urls.some((url) => isVideoLikeUrl(url))
      );
    },
    async execute(plan) {
      const videoUrls = plan.normalizedInput.urls.filter((url) => isVideoLikeUrl(url));
      const retrievedAt = now();

      const artifacts = await Promise.all(
        videoUrls.map(async (url, index) => {
          let result: ExecResult;

          try {
            result = await exec("yt-dlp", ["--no-playlist", "-J", url]);
          } catch (error) {
            return buildFailureArtifact({
              id: `${ADAPTER_NAME}-${index}`,
              adapter: ADAPTER_NAME,
              fetcher: FETCHER_NAME,
              url,
              sourceType: "video",
              outcome: {
                status: "error",
                blockReason: "unknown",
                bypassLevel: "none",
                loginRequired: false
              },
              errorMessage: error instanceof Error ? error.message : String(error),
              sourceLabel: "video/error",
              retrievedAt
            });
          }

          if (result.timedOut) {
            return buildFailureArtifact({
              id: `${ADAPTER_NAME}-${index}`,
              adapter: ADAPTER_NAME,
              fetcher: FETCHER_NAME,
              url,
              sourceType: "video",
              outcome: {
                status: "timeout",
                blockReason: "unknown",
                bypassLevel: "none",
                loginRequired: false
              },
              errorMessage: result.stderr || "reclip executor timed out",
              sourceLabel: "video/timeout",
              retrievedAt
            });
          }

          if (result.exitCode !== 0) {
            const failure = classifyFailure(result.stderr || result.stdout);
            return buildFailureArtifact({
              id: `${ADAPTER_NAME}-${index}`,
              adapter: ADAPTER_NAME,
              fetcher: FETCHER_NAME,
              url,
              sourceType: "video",
              outcome: {
                status: failure.status,
                blockReason: failure.blockReason,
                bypassLevel: "none",
                loginRequired: failure.loginRequired
              },
              errorMessage: truncateErrorMessage(result.stderr || result.stdout || `yt-dlp exit ${result.exitCode}`),
              sourceLabel: `video/${failure.status}`,
              retrievedAt
            });
          }

          let info: ReclipInfo;
          try {
            info = JSON.parse(result.stdout) as ReclipInfo;
          } catch (error) {
            return buildFailureArtifact({
              id: `${ADAPTER_NAME}-${index}`,
              adapter: ADAPTER_NAME,
              fetcher: FETCHER_NAME,
              url,
              sourceType: "video",
              outcome: {
                status: "error",
                blockReason: "unknown",
                bypassLevel: "none",
                loginRequired: false
              },
              errorMessage: `reclip parse: ${error instanceof Error ? error.message : String(error)}`,
              sourceLabel: "video/error",
              retrievedAt
            });
          }

          try {
            return await infoToArtifact(info, index, retrievedAt, plan, {
              fetchText,
              normalize,
              storeRaw
            });
          } catch (error) {
            return buildFailureArtifact({
              id: `${ADAPTER_NAME}-${index}`,
              adapter: ADAPTER_NAME,
              fetcher: FETCHER_NAME,
              url,
              sourceType: "video",
              outcome: {
                status: "error",
                blockReason: "unknown",
                bypassLevel: "none",
                loginRequired: false
              },
              errorMessage: error instanceof Error ? error.message : String(error),
              sourceLabel: "video/error",
              retrievedAt
            });
          }
        })
      );

      return artifacts;
    }
  };
}
