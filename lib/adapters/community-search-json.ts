import { createHash } from "node:crypto";

import {
  buildArtifact,
  buildFailureArtifact,
  deriveTitleFromUrl,
  truncateErrorMessage,
  type FetchOutcome
} from "@/lib/adapters/contract";
import { canonicalize, hostnameOf } from "@/lib/adapters/url";
import type { ResearchAdapter, ResearchPlan, SourceArtifact } from "@/lib/adapters/types";
import { normalizeToMarkdown, type NormalizeFormat } from "@/lib/normalize/markitdown";
import { storeRawPayload } from "@/lib/normalize/raw-store";

const ADAPTER_NAME = "community-search-json";
const FETCHER_NAME = "community-search-json";

export type CommunitySearchJsonExecutor = (input: {
  url: string;
  timeoutMs: number;
}) => Promise<{ body: string; status: number; contentType?: string } | null>;

type CreateOpts = {
  exec?: CommunitySearchJsonExecutor;
  now?: () => string;
  normalize?: typeof normalizeToMarkdown;
  storeRaw?: typeof storeRawPayload;
};

type RedditSearchResponse = {
  data?: {
    children?: Array<{
      kind?: string;
      data?: {
        id?: string;
        title?: string;
        selftext?: string;
        url?: string;
        permalink?: string;
        subreddit?: string;
        author?: string;
        score?: number;
        num_comments?: number;
        created_utc?: number;
      };
    }>;
  };
};

type HnAlgoliaResponse = {
  hits?: Array<{
    objectID?: string;
    title?: string;
    story_title?: string;
    story_text?: string;
    comment_text?: string;
    url?: string;
    author?: string;
    created_at_i?: number;
    num_comments?: number;
    points?: number;
    _tags?: string[];
  }>;
};

type ParsedItem = {
  id: string;
  title: string;
  url: string;
  content: string;
  relevanceBody?: string;
  publishedAt?: string;
  extra?: Record<string, string | undefined>;
  normalizeFormat?: NormalizeFormat;
};

const QUERY_STOPWORDS = new Set([
  "vs",
  "the",
  "and",
  "or",
  "for",
  "to",
  "a",
  "an",
  "is",
  "are",
  "은",
  "는",
  "이",
  "가",
  "도",
  "에",
  "의",
  "을",
  "를"
]);

const SHORT_TOKEN_ALLOWLIST = new Set([
  "rust",
  "go",
  "vue",
  "ruby",
  "php",
  "r",
  "lua",
  "rsc",
  "spa",
  "ssr",
  "csr",
  "pwa",
  "rest",
  "grpc",
  "http2",
  "ai",
  "ml",
  "nlp",
  "llm",
  "gpt",
  "rag",
  "llms",
  "ci",
  "cd",
  "qa",
  "k8s",
  "aws",
  "gcp",
  "iam",
  "vpc",
  "css",
  "js",
  "ts",
  "jsx",
  "tsx",
  "sql",
  "orm",
  "etl",
  "db",
  "mvp",
  "seo",
  "kpi",
  "ops",
  "dev",
  "pm"
]);

export function isCommunitySearchJsonUrl(url: string): boolean {
  const host = hostnameOf(url);
  const pathname = safePathname(url);
  if (!host || !pathname) return false;

  return (
    ((host === "reddit.com" || host === "www.reddit.com") &&
      pathname === "/search.json") ||
    (host === "hn.algolia.com" && pathname.startsWith("/api/v1/search"))
  );
}

export function createCommunitySearchJsonAdapter(deps?: CreateOpts): ResearchAdapter {
  const exec = deps?.exec ?? defaultExecutor;
  const now = deps?.now ?? (() => new Date().toISOString());
  const normalize = deps?.normalize ?? normalizeToMarkdown;
  const storeRaw = deps?.storeRaw ?? storeRawPayload;

  return {
    name: ADAPTER_NAME,
    supports(plan: ResearchPlan) {
      return plan.normalizedInput.urls.some((url) => isCommunitySearchJsonUrl(url));
    },
    async execute(plan: ResearchPlan) {
      const matchedUrls = plan.normalizedInput.urls.filter((url) =>
        isCommunitySearchJsonUrl(url)
      );
      const artifacts = await Promise.all(
        matchedUrls.map((url, index) =>
          fetchSearchUrl({
            url,
            index,
            retrievedAt: now(),
            projectId: plan.projectId,
            runId: plan.runId,
            exec,
            normalize,
            storeRaw
          })
        )
      );

      return artifacts.flat();
    }
  };
}

async function fetchSearchUrl(args: {
  url: string;
  index: number;
  retrievedAt: string;
  projectId: string;
  runId: string;
  exec: CommunitySearchJsonExecutor;
  normalize: typeof normalizeToMarkdown;
  storeRaw: typeof storeRawPayload;
}): Promise<SourceArtifact[]> {
  const { url, index, retrievedAt, projectId, runId, exec, normalize, storeRaw } = args;

  let response: Awaited<ReturnType<CommunitySearchJsonExecutor>>;
  try {
    response = await exec({ url, timeoutMs: 15_000 });
  } catch (error) {
    return [
      buildCommunityFailure({
        url,
        index,
        retrievedAt,
        errorMessage: error instanceof Error ? error.message : String(error)
      })
    ];
  }

  if (!response) {
    return [
      buildCommunityFailure({
        url,
        index,
        retrievedAt,
        errorMessage: "community-search-json executor returned null"
      })
    ];
  }

  if (response.status >= 400) {
    return [
      buildCommunityFailure({
        url,
        index,
        retrievedAt,
        errorMessage: `community-search-json http ${response.status}`
      })
    ];
  }

  let rawRef: string | undefined;
  try {
    rawRef = await storeRaw({
      projectId,
      runId,
      adapter: ADAPTER_NAME,
      format: "json",
      payload: response.body
    });
  } catch (error) {
    return [
      buildCommunityFailure({
        url,
        index,
        retrievedAt,
        errorMessage: error instanceof Error ? error.message : String(error)
      })
    ];
  }

  let items: ParsedItem[];
  let droppedCount = 0;
  const query = extractQueryFromUrl(url);
  const tokens = query ? extractDistinctiveTokens(query) : [];
  try {
    const parsed = parseSearchBody(url, response.body);
    const filtered = parsed.items.filter((item) =>
      isPostRelevant(item.title, item.relevanceBody ?? item.content, tokens)
    );
    droppedCount = parsed.items.length - filtered.length;
    items = filtered.map((item) => ({
      ...item,
      extra: {
        ...item.extra,
        community_filter_tokens: tokens.join(";"),
        community_filter_dropped: String(droppedCount)
      }
    }));
  } catch (error) {
    return [
      buildCommunityFailure({
        url,
        index,
        retrievedAt,
        errorMessage: error instanceof Error ? error.message : String(error)
      })
    ];
  }

  if (tokens.length > 0 && items.length === 0) {
    return [
      buildArtifact({
        id: `${ADAPTER_NAME}-${index}`,
        adapter: ADAPTER_NAME,
        fetcher: FETCHER_NAME,
        url,
        canonicalUrl: canonicalize(url) || undefined,
        sourceType: "community",
        title: deriveTitleFromUrl(url),
        snippet: "",
        content: "",
        sourcePriority: "community",
        retrievedAt,
        rawRef,
        outcome: { status: "partial" },
        sourceLabel: "community/partial",
        rateLimitBucket: "community-search-json/search",
        extra: {
          error: "no posts matched relevance filter",
          community_filter_tokens: tokens.join(";"),
          community_filter_dropped: String(droppedCount)
        }
      })
    ];
  }

  if (items.length === 0) return [];

  return Promise.all(
    items.map(async (item, itemIndex) =>
      parsedItemToArtifact({
        item,
        itemIndex,
        index,
        retrievedAt,
        rawRef,
        normalize
      })
    )
  );
}

function parseSearchBody(url: string, body: string): { items: ParsedItem[] } {
  const host = hostnameOf(url);
  const parsed = JSON.parse(body) as RedditSearchResponse | HnAlgoliaResponse;

  if (host === "reddit.com" || host === "www.reddit.com") {
    return { items: parseRedditResponse(parsed as RedditSearchResponse) };
  }

  if (host === "hn.algolia.com") {
    return { items: parseHnResponse(parsed as HnAlgoliaResponse) };
  }

  throw new Error("unsupported community-search-json host");
}

function parseRedditResponse(response: RedditSearchResponse): ParsedItem[] {
  const children = response.data?.children;
  if (!Array.isArray(children)) {
    throw new Error("reddit search response missing data.children");
  }

  return children.flatMap((child, index) => {
    if (child.kind !== "t3" || !child.data) return [];

    const permalink = child.data.permalink?.trim();
    const title = (child.data.title ?? "").trim();
    if (!permalink || !title) return [];

    return [
      {
        id: child.data.id?.trim() || hashString(`${index}:${permalink}`),
        title,
        url: absolutizeRedditPermalink(permalink),
        content: child.data.selftext?.trim() ?? "",
        relevanceBody: child.data.selftext?.trim() ?? "",
        publishedAt: unixToIso(child.data.created_utc),
        extra: {
          subreddit: child.data.subreddit?.trim(),
          author: child.data.author?.trim(),
          score: stringifyNumber(child.data.score),
          num_comments: stringifyNumber(child.data.num_comments)
        },
        normalizeFormat: "text"
      }
    ];
  });
}

function parseHnResponse(response: HnAlgoliaResponse): ParsedItem[] {
  const hits = response.hits;
  if (!Array.isArray(hits)) {
    throw new Error("hn algolia response missing hits");
  }

  return hits.flatMap((hit, index) => {
    const objectId = hit.objectID?.trim();
    if (!objectId) return [];

    const tags = hit._tags ?? [];
    const isComment = tags.includes("comment");
    const hnKind = isComment ? "comment" : "story";
    const storyTitle = hit.story_title?.trim() ?? "";
    const rawContent = isComment
      ? hit.comment_text?.trim() ?? ""
      : hit.story_text?.trim() ?? "";
    const title = isComment
      ? truncate(commentPreview(rawContent), 80) || `HN comment ${objectId}`
      : (hit.title?.trim() || deriveTitleFromUrl(hit.url ?? "") || `HN story ${objectId}`);

    return [
      {
        id: objectId || hashString(`${index}:${title}`),
        title,
        url: `https://news.ycombinator.com/item?id=${objectId}`,
        content: rawContent || (isComment ? "" : hit.title?.trim() ?? ""),
        relevanceBody: isComment
          ? `${storyTitle} ${rawContent}`.trim()
          : `${title} ${rawContent}`.trim(),
        publishedAt: unixToIso(hit.created_at_i),
        extra: {
          author: hit.author?.trim(),
          points: stringifyNumber(hit.points),
          num_comments: stringifyNumber(hit.num_comments),
          hn_kind: hnKind,
          story_title: storyTitle || undefined
        },
        normalizeFormat: shouldNormalizeAsHtml(rawContent) ? "html" : "text"
      }
    ];
  });
}

async function parsedItemToArtifact(args: {
  item: ParsedItem;
  itemIndex: number;
  index: number;
  retrievedAt: string;
  rawRef?: string;
  normalize: typeof normalizeToMarkdown;
}): Promise<SourceArtifact> {
  const { item, itemIndex, index, retrievedAt, rawRef, normalize } = args;
  const normalizedContent = item.content
    ? await normalize({
        format: item.normalizeFormat ?? "text",
        payload: item.content
      })
    : "";
  const snippet = normalizedContent.trim()
    ? normalizedContent.replace(/\s+/g, " ").slice(0, 240)
    : "";

  return buildArtifact({
    id: `${ADAPTER_NAME}-${sourcePrefix(item.url)}-${index}-${itemIndex}-${item.id}`,
    adapter: ADAPTER_NAME,
    fetcher: FETCHER_NAME,
    sourceType: "community",
    title: item.title,
    url: item.url,
    canonicalUrl: canonicalize(item.url) || undefined,
    snippet,
    content: normalizedContent,
    sourcePriority: "community",
    retrievedAt,
    publishedAt: item.publishedAt,
    rawRef,
    outcome: { status: "success" },
    sourceLabel: "community/success",
    rateLimitBucket: "community-search-json/search",
    extra: {
      community_filter_tokens: "",
      community_filter_dropped: "0",
      ...item.extra
    }
  });
}

function buildCommunityFailure(args: {
  url: string;
  index: number;
  retrievedAt: string;
  errorMessage: string;
}): SourceArtifact {
  return buildFailureArtifact({
    id: `${ADAPTER_NAME}-${args.index}`,
    adapter: ADAPTER_NAME,
    fetcher: FETCHER_NAME,
    url: args.url,
    sourceType: "community",
    retrievedAt: args.retrievedAt,
    outcome: { status: "error" },
    errorMessage: truncateErrorMessage(args.errorMessage),
    sourceLabel: "community/error"
  });
}

const defaultExecutor: CommunitySearchJsonExecutor = async ({ url, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "DecisionEngine/1.0 community-search-json"
      },
      signal: controller.signal
    });

    return {
      body: await response.text(),
      status: response.status,
      contentType: response.headers.get("content-type") ?? undefined
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

function safePathname(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function absolutizeRedditPermalink(permalink: string): string {
  return new URL(permalink, "https://reddit.com").toString();
}

function unixToIso(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return new Date(value * 1000).toISOString();
}

function stringifyNumber(value: number | undefined): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function shouldNormalizeAsHtml(value: string): boolean {
  return /<[^>]+>/.test(value);
}

function commentPreview(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function sourcePrefix(url: string): string {
  return hostnameOf(url)?.includes("reddit.com") ? "reddit" : "hn";
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function extractQueryFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("q") ?? parsed.searchParams.get("query");
  } catch {
    return null;
  }
}

function extractDistinctiveTokens(query: string): string[] {
  const tokens =
    query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

  const distinct = new Set<string>();
  for (const token of tokens) {
    const isHangulOrCjk = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
      token
    );
    if (QUERY_STOPWORDS.has(token)) continue;
    if (!(token.length >= 5 || isHangulOrCjk || SHORT_TOKEN_ALLOWLIST.has(token))) continue;
    distinct.add(token);
  }

  return [...distinct];
}

function isPostRelevant(title: string, body: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = `${title} ${body}`.normalize("NFKC").toLowerCase();
  return tokens.some((token) => haystack.includes(token.toLowerCase()));
}
