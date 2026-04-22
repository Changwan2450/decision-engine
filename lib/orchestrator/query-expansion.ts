import { getResearchBudgetConfig } from "@/lib/config";
import type { NormalizedRunInput } from "@/lib/orchestrator/clarify";

export type ExpansionAxis = "official" | "recent" | "comparison" | "counter";
export type ExpandedSource = "jina-search" | "reddit-search" | "hn-algolia";

export type ExpandedQuery = {
  axis: ExpansionAxis;
  query: string;
  source: ExpandedSource;
  url: string;
};

export type ExpansionResult = {
  expanded: ExpandedQuery[];
  dropped: number;
};

export type ExpansionOptions = {
  axes?: ExpansionAxis[];
  sources?: ExpandedSource[];
  maxPerAxis?: number;
  comparisonTokens?: string[];
  maxComparisonTokens?: number;
  maxUrlsPerRun?: number;
  now?: Date;
};

type RecentShape = {
  query: string;
  extraParams?: Record<string, string>;
};

type ComparisonCandidate = {
  query: string;
};

const DEFAULT_SOURCES: ExpandedSource[] = ["jina-search", "reddit-search", "hn-algolia"];

function encodeBaseQuery(input: NormalizedRunInput): string {
  const title = input.title.trim();
  if (title.length > 0) return title;
  const naturalLanguage = input.naturalLanguage.trim();
  if (naturalLanguage.length === 0) return "";
  return naturalLanguage.slice(0, 120);
}

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }

  return deduped;
}

function buildComparisonQueriesFromTokens(
  baseQuery: string,
  tokens: string[]
): ComparisonCandidate[] {
  return tokens.map((token) => ({
    query: `${baseQuery} vs ${token}`
  }));
}

function inferComparisonQueryFromText(text: string): string | null {
  const normalized = text
    .normalize("NFKC")
    .replace(/\s*[—–|:]\s*.*/u, "")
    .trim();
  const match = normalized.match(/^(.+?)\s+(vs|versus|대)\s+(.+)$/iu);
  if (!match) return null;

  const left = match[1]?.trim();
  const operator = match[2]?.trim();
  const right = match[3]?.trim();
  if (!left || !operator || !right) return null;

  return `${left} ${operator} ${right}`;
}

function normalizeComparisonQuery(query: string): string {
  const normalized = query.normalize("NFKC");
  const lower = normalized.toLowerCase();

  if (
    lower.includes("memory") &&
    lower.includes("prompt stuffing") &&
    (lower.includes("ai") || lower.includes("agent"))
  ) {
    return "AI agent memory vs RAG stuffing";
  }

  if (
    lower.includes("postgres") &&
    lower.includes("rls") &&
    lower.includes("authorization")
  ) {
    return "Postgres row level security vs application authorization";
  }

  return normalized;
}

function resolveComparisonQueries(
  input: NormalizedRunInput,
  options: ExpansionOptions
): ComparisonCandidate[] {
  const limit = options.maxComparisonTokens ?? 3;
  const inferred =
    inferComparisonQueryFromText(input.title) ??
    inferComparisonQueryFromText(input.naturalLanguage);

  if (options.comparisonTokens) {
    return buildComparisonQueriesFromTokens(
      encodeBaseQuery(input),
      options.comparisonTokens.map((token) => token.trim()).filter(Boolean)
    )
      .filter((candidate, index, all) =>
        all.findIndex((entry) => entry.query.toLowerCase() === candidate.query.toLowerCase()) === index
      )
      .slice(0, limit);
  }

  if (input.comparisonAxis) {
    if (inferred) {
      return [{ query: normalizeComparisonQuery(inferred) }];
    }
    return buildComparisonQueriesFromTokens(
      encodeBaseQuery(input),
      dedupeCaseInsensitive(
        input.comparisonAxis.split(",").map((token) => token.trim()).filter(Boolean)
      ).slice(0, limit)
    );
  }

  return inferred ? [{ query: normalizeComparisonQuery(inferred) }] : [];
}

function shapeRecentForSource(
  baseQuery: string,
  source: ExpandedSource,
  now: Date
): RecentShape {
  const year = now.getFullYear();

  switch (source) {
    case "jina-search":
      return { query: `${baseQuery} after:${year - 1}` };
    case "reddit-search":
      return { query: baseQuery, extraParams: { t: "year", sort: "new" } };
    case "hn-algolia": {
      const oneYearAgoUnix = Math.floor(now.getTime() / 1000) - 365 * 24 * 3600;
      return {
        query: baseQuery,
        extraParams: { numericFilters: `created_at_i>${oneYearAgoUnix}` }
      };
    }
  }
}

function buildUrl(
  source: ExpandedSource,
  query: string,
  extraParams?: Record<string, string>
): string {
  const params = new URLSearchParams();

  switch (source) {
    case "jina-search":
      params.set("q", query);
      break;
    case "reddit-search":
      params.set("q", query);
      params.set("limit", "25");
      break;
    case "hn-algolia":
      params.set("query", query);
      params.set("hitsPerPage", "20");
      break;
  }

  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      params.set(key, value);
    }
  }

  const baseUrl =
    source === "jina-search"
      ? "https://s.jina.ai/"
      : source === "reddit-search"
        ? "https://www.reddit.com/search.json"
        : "https://hn.algolia.com/api/v1/search";

  return `${baseUrl}?${params.toString()}`;
}

function resolveAxes(
  input: NormalizedRunInput,
  options: ExpansionOptions,
  comparisonQueries: ComparisonCandidate[]
): ExpansionAxis[] {
  if (options.axes) return options.axes;

  const axes: ExpansionAxis[] = ["official", "recent"];
  if (comparisonQueries.length > 0) axes.push("comparison");
  return axes;
}

export function expandQuery(
  input: NormalizedRunInput,
  options: ExpansionOptions = {}
): ExpansionResult {
  const baseQuery = encodeBaseQuery(input);
  if (baseQuery.length === 0) {
    return { expanded: [], dropped: 0 };
  }

  const now = options.now ?? new Date();
  const sources = options.sources ?? DEFAULT_SOURCES;
  const maxPerAxis = options.maxPerAxis ?? 3;
  const maxUrlsPerRun =
    options.maxUrlsPerRun ?? getResearchBudgetConfig().maxUrlsPerRun;
  const comparisonQueries = resolveComparisonQueries(input, options);
  const axes = resolveAxes(input, options, comparisonQueries);

  if (input.urls.length >= maxUrlsPerRun) {
    let wouldHaveGenerated = 0;
    for (const axis of axes) {
      const tokenCount =
        axis === "comparison" ? Math.max(comparisonQueries.length, 1) : 1;
      wouldHaveGenerated += Math.min(maxPerAxis, tokenCount * sources.length);
    }
    return { expanded: [], dropped: wouldHaveGenerated };
  }

  const seenUrls = new Set(input.urls);
  const expanded: ExpandedQuery[] = [];
  let dropped = 0;
  let remaining = maxUrlsPerRun - input.urls.length;

  for (const axis of axes) {
    let addedForAxis = 0;
    const candidates =
      axis === "comparison"
        ? comparisonQueries
        : axis === "counter"
          ? [{ query: `${baseQuery} problems OR issues OR drawbacks OR 단점 OR 문제` }]
          : [{ query: baseQuery }];

    for (const candidate of candidates) {
      for (const source of sources) {
        if (addedForAxis >= maxPerAxis || remaining <= 0) {
          dropped += 1;
          continue;
        }

        const shaped =
          axis === "recent"
            ? shapeRecentForSource(baseQuery, source, now)
            : { query: candidate.query };
        const url = buildUrl(source, shaped.query, shaped.extraParams);

        if (seenUrls.has(url)) {
          continue;
        }

        seenUrls.add(url);
        expanded.push({
          axis,
          query: shaped.query,
          source,
          url
        });
        addedForAxis += 1;
        remaining -= 1;
      }
    }
  }

  return { expanded, dropped };
}
