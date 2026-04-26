export type DomainTargetedDiscoveryCandidate = {
  url: string;
  title?: string;
  snippet?: string;
  hostClass: "official" | "primary";
};

export type DomainTargetedDiscoveryResult = {
  query: string;
  source: "domain-targeted-search";
  candidates: DomainTargetedDiscoveryCandidate[];
  rawResultCount: number;
  allowedResultCount: number;
  errors: string[];
};

type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

type DiscoverOpts = {
  fetchImpl?: FetchLike;
  limit?: number;
};

const SOURCE = "domain-targeted-search" as const;
const MAX_CANDIDATES = 5;
const OFFICIAL_HOSTS = ["openai.com", "anthropic.com"] as const;
const PRIMARY_HOSTS = ["arxiv.org", "acm.org"] as const;
const REJECTED_HOSTS = [
  "s.jina.ai",
  "r.jina.ai",
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "news.ycombinator.com",
  "hn.algolia.com",
  "duckduckgo.com",
  "html.duckduckgo.com"
] as const;

export function buildDomainTargetedSearchUrl(query: string): string {
  const scopedQuery = `${query} site:openai.com OR site:anthropic.com OR site:arxiv.org OR site:acm.org`;
  const params = new URLSearchParams();
  params.set("q", scopedQuery);
  params.set("kl", "us-en");
  return `https://html.duckduckgo.com/html/?${params.toString()}`;
}

export async function discoverDomainTargetedCandidates(
  query: string,
  opts?: DiscoverOpts
): Promise<DomainTargetedDiscoveryResult> {
  const fetchImpl = opts?.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    return emptyResult(query, ["fetch_unavailable"]);
  }

  const url = buildDomainTargetedSearchUrl(query);

  try {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": "DecisionEngine/1.0 domain-targeted-search"
      }
    });

    if (!response.ok) {
      return emptyResult(query, [`http_${response.status}`]);
    }

    const html = await response.text();
    return parseDomainTargetedSearchHtml(query, html, opts?.limit);
  } catch {
    return emptyResult(query, ["fetch_failed"]);
  }
}

export function parseDomainTargetedSearchHtml(
  query: string,
  html: string,
  limit = MAX_CANDIDATES
): DomainTargetedDiscoveryResult {
  const candidates: DomainTargetedDiscoveryCandidate[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let rawResultCount = 0;

  const anchorPattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null = null;

  while ((match = anchorPattern.exec(html)) !== null) {
    const href = decodeHtmlEntities(match[2] ?? "");
    const resolved = extractDirectUrlFromHref(href);
    if (!resolved) continue;
    rawResultCount += 1;

    const normalized = normalizeCandidateUrl(resolved);
    if (!normalized || seen.has(normalized.url)) continue;
    seen.add(normalized.url);

    candidates.push({
      url: normalized.url,
      title: normalizeText(match[3]),
      hostClass: normalized.hostClass
    });

    if (candidates.length >= limit) break;
  }

  if (rawResultCount === 0) {
    errors.push("no_result_links_found");
  }

  return {
    query,
    source: SOURCE,
    candidates,
    rawResultCount,
    allowedResultCount: candidates.length,
    errors
  };
}

function emptyResult(query: string, errors: string[]): DomainTargetedDiscoveryResult {
  return {
    query,
    source: SOURCE,
    candidates: [],
    rawResultCount: 0,
    allowedResultCount: 0,
    errors
  };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeText(value: string): string | undefined {
  const text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

function extractDirectUrlFromHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const withOrigin = trimmed.startsWith("//")
    ? `https:${trimmed}`
    : trimmed.startsWith("/")
      ? `https://duckduckgo.com${trimmed}`
      : null;
  if (!withOrigin) return null;

  try {
    const parsed = new URL(withOrigin);
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : null;
  } catch {
    return null;
  }
}

function normalizeCandidateUrl(
  rawUrl: string
): { url: string; hostClass: "official" | "primary" } | null {
  try {
    const parsed = new URL(rawUrl);
    if (!/^https?:$/.test(parsed.protocol)) return null;

    const host = parsed.hostname.toLowerCase();
    if (REJECTED_HOSTS.some((knownHost) => hostMatches(host, knownHost))) return null;

    const hostClass = classifyHost(host);
    if (!hostClass) return null;

    parsed.hash = "";
    return {
      url: parsed.toString(),
      hostClass
    };
  } catch {
    return null;
  }
}

function classifyHost(host: string): "official" | "primary" | null {
  if (OFFICIAL_HOSTS.some((knownHost) => hostMatches(host, knownHost))) {
    return "official";
  }

  if (PRIMARY_HOSTS.some((knownHost) => hostMatches(host, knownHost))) {
    return "primary";
  }

  return null;
}

function hostMatches(host: string, knownHost: string): boolean {
  return host === knownHost || host.endsWith(`.${knownHost}`);
}
