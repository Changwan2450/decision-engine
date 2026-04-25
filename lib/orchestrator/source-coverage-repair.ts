export type SourceCoverageRepairTrigger = {
  hasOfficialOrPrimaryEvidence?: boolean;
  sourceCoverageWarnings?: string[];
};

export type SourceCoverageRepairPlan = {
  shouldRun: boolean;
  reason: "no_official_or_primary_evidence" | null;
  discovery: {
    url: string;
    query: string;
    repairPass: "source_coverage_v1";
    repairStage: "discovery";
    repairReason: "no_official_or_primary_evidence";
  } | null;
};

const REPAIR_PASS = "source_coverage_v1" as const;
const REPAIR_STAGE_DISCOVERY = "discovery" as const;
const REPAIR_REASON = "no_official_or_primary_evidence" as const;
const MAX_FOLLOW_URLS = 3;
const DISCOVERY_HOST = "s.jina.ai";
const OFFICIAL_REPAIR_HOSTS = ["openai.com", "anthropic.com"] as const;
const PRIMARY_REPAIR_HOSTS = ["arxiv.org", "acm.org"] as const;
const ALL_REPAIR_HOSTS = [...OFFICIAL_REPAIR_HOSTS, ...PRIMARY_REPAIR_HOSTS] as const;

function buildJinaSearchUrl(query: string): string {
  const params = new URLSearchParams();
  params.set("q", query);
  return `https://s.jina.ai/?${params.toString()}`;
}

function uniqueQueries(values: string[]): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];

  for (const value of values) {
    const query = value.replace(/\s+/g, " ").trim();
    const key = query.toLowerCase();
    if (!query || seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
  }

  return queries;
}

export function planSourceCoverageRepair(input: {
  title: string;
  goal?: string;
  summary: SourceCoverageRepairTrigger;
}): SourceCoverageRepairPlan {
  const hasOfficialOrPrimaryEvidence = input.summary.hasOfficialOrPrimaryEvidence === true;
  const hasCoverageWarning =
    input.summary.sourceCoverageWarnings?.includes(REPAIR_REASON) === true;
  const shouldRun =
    hasOfficialOrPrimaryEvidence === false &&
    (input.summary.hasOfficialOrPrimaryEvidence === false || hasCoverageWarning);

  if (!shouldRun) {
    return {
      shouldRun: false,
      reason: null,
      discovery: null
    };
  }

  const title = input.title.trim();
  const goalOrTitle = input.goal?.trim() || title;
  const query = uniqueQueries([
    `${title} official documentation`,
    `${goalOrTitle} site:openai.com OR site:anthropic.com OR site:arxiv.org OR site:acm.org`
  ])[0];

  return {
    shouldRun: true,
    reason: REPAIR_REASON,
    discovery: {
      url: buildJinaSearchUrl(query),
      query,
      repairPass: REPAIR_PASS,
      repairStage: REPAIR_STAGE_DISCOVERY,
      repairReason: REPAIR_REASON,
    }
  };
}

function hostMatches(host: string, knownHost: string): boolean {
  return host === knownHost || host.endsWith(`.${knownHost}`);
}

export function isAllowedOfficialPrimaryRepairHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === DISCOVERY_HOST || normalized === "r.jina.ai") return false;
  return ALL_REPAIR_HOSTS.some((knownHost) => hostMatches(normalized, knownHost));
}

export function classifyRepairHost(host: string): "official" | "primary" | null {
  const normalized = host.trim().toLowerCase();
  if (OFFICIAL_REPAIR_HOSTS.some((knownHost) => hostMatches(normalized, knownHost))) {
    return "official";
  }
  if (PRIMARY_REPAIR_HOSTS.some((knownHost) => hostMatches(normalized, knownHost))) {
    return "primary";
  }
  return null;
}

function normalizeRepairUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    if (!isAllowedOfficialPrimaryRepairHost(parsed.hostname)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractCandidateUrls(value: string): string[] {
  return value.match(/https?:\/\/[^\s)>"']+/g) ?? [];
}

function dedupeAllowedUrls(urls: string[], limit = MAX_FOLLOW_URLS): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const rawUrl of urls) {
    const normalized = normalizeRepairUrl(rawUrl);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
    if (deduped.length >= limit) break;
  }

  return deduped;
}

export function extractAllowedRepairUrlsFromDiscovery(input: {
  content?: string;
  snippet?: string;
  title?: string;
  metadata?: Record<string, string | undefined>;
  limit?: number;
}): string[] {
  const limit = input.limit ?? MAX_FOLLOW_URLS;
  const values = [
    input.content ?? "",
    input.snippet ?? "",
    input.title ?? "",
    input.metadata?.raw_url ?? "",
    input.metadata?.resolved_url ?? "",
    input.metadata?.links ?? ""
  ];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const value of values) {
    for (const candidate of extractCandidateUrls(value)) {
      const normalized = normalizeRepairUrl(candidate);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(normalized);
      if (urls.length >= limit) return urls;
    }
  }

  return urls;
}

export function extractAllowedUrlsFromRedditSearchJson(
  rawJson: string,
  limit = MAX_FOLLOW_URLS
): string[] {
  try {
    const parsed = JSON.parse(rawJson) as {
      data?: { children?: Array<{ data?: { url?: unknown } }> };
    };
    const children = parsed.data?.children;
    if (!Array.isArray(children)) return [];

    return dedupeAllowedUrls(
      children.flatMap((child) => {
        const url = child?.data?.url;
        return typeof url === "string" ? [url] : [];
      }),
      limit
    );
  } catch {
    return [];
  }
}

export function extractAllowedUrlsFromHnAlgoliaJson(
  rawJson: string,
  limit = MAX_FOLLOW_URLS
): string[] {
  try {
    const parsed = JSON.parse(rawJson) as {
      hits?: Array<{ url?: unknown }>;
    };
    const hits = parsed.hits;
    if (!Array.isArray(hits)) return [];

    return dedupeAllowedUrls(
      hits.flatMap((hit) => {
        const url = hit?.url;
        return typeof url === "string" ? [url] : [];
      }),
      limit
    );
  } catch {
    return [];
  }
}

export function extractAllowedUrlsFromCommunitySearchJson(input: {
  rawJson: string;
  discoveryUrl: string;
  limit?: number;
}): string[] {
  const host = (() => {
    try {
      return new URL(input.discoveryUrl).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();

  if (host === "reddit.com" || host === "www.reddit.com") {
    return extractAllowedUrlsFromRedditSearchJson(input.rawJson, input.limit);
  }

  if (host === "hn.algolia.com") {
    return extractAllowedUrlsFromHnAlgoliaJson(input.rawJson, input.limit);
  }

  return [];
}
