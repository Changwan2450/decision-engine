// Adapter routing table for the Decision Engine.
//
// `supports` answers "can this adapter handle this plan". `routeUrl` answers
// a different, orthogonal question: "for a given URL, which adapter should
// go first, and which adapters pick up if primary fails?".
//
// Keeping these concerns separate means:
//   - adapters stay single-responsibility (know what they can do)
//   - orchestration policy (precedence, fallback order) is a single data
//     structure that can evolve without changing adapter code
//   - tests can assert the policy directly, independent of adapters
//
// PR 1 scope: this module is NOT yet wired into run-research.ts. That swap
// happens in PR 4 alongside 3-tier budget enforcement.

import { hostnameOf } from "@/lib/adapters/url";

/** Known adapter identifiers. Keep in sync with adapter module `name` fields. */
export type AdapterName =
  | "agent-reach"
  | "community-search-json"
  | "scrapling"
  | "reclip"
  | "opendataloader-pdf"
  | "markitdown"
  | "geocoding"
  | "kb-preread";

/** Routing decision for a single URL: primary first, then fallbacks in order. */
export type AdapterChain = {
  primary: AdapterName;
  fallbacks: AdapterName[];
  /** Human-readable tag explaining why this rule matched (for tests / logs). */
  rule: string;
};

// ---- matcher primitives -------------------------------------------------

type HostnamePredicate = (host: string) => boolean;

type Rule = {
  match: HostnamePredicate | "pdf-ext" | "arxiv";
  chain: Omit<AdapterChain, "rule">;
  rule: string;
};

function hostEndsWith(...suffixes: string[]): HostnamePredicate {
  return (host: string) =>
    suffixes.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`)
    );
}

function hostEquals(...hosts: string[]): HostnamePredicate {
  return (host: string) => hosts.includes(host);
}

function isKnownPublicFeedUrl(url: string): boolean {
  const pathname = safePathname(url)?.toLowerCase() ?? "";
  return (
    pathname.endsWith(".xml") ||
    pathname.endsWith("/feed") ||
    pathname.endsWith("/rss") ||
    pathname.includes("/feed/") ||
    pathname.includes("/rss/")
  );
}

function isJinaReaderMirror(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  if (host !== "r.jina.ai" && host !== "s.jina.ai") return false;

  const pathname = safePathname(url);
  return Boolean(pathname && pathname !== "/");
}

// ---- routing table ------------------------------------------------------
//
// Order matters: the first rule whose matcher returns true wins.
// Changing this table = changing routing policy. Mirror changes in
// docs/INTEGRATION_ARCHITECTURE.md §4.0.

const RULES: Rule[] = [
  // Lightweight/public endpoints — these are the first slice of the
  // insane-search-style fallback policy absorbed into the engine. We do not
  // integrate the plugin package itself; we only recognize endpoints that are
  // already public, text-oriented, or mirror-friendly so downstream logs can
  // distinguish them from generic blocked-web routing.
  {
    match: hostEquals("r.jina.ai", "s.jina.ai"),
    chain: { primary: "scrapling", fallbacks: ["markitdown"] },
    rule: "web/public-mirror"
  },

  // Video platforms — agent-reach first (cheap transcript API),
  // reclip only as fallback (expensive download + STT).
  {
    match: hostEndsWith("youtube.com", "youtu.be"),
    chain: { primary: "agent-reach", fallbacks: ["reclip"] },
    rule: "video/youtube"
  },
  {
    match: hostEndsWith("bilibili.com", "b23.tv"),
    chain: { primary: "agent-reach", fallbacks: ["reclip"] },
    rule: "video/bilibili"
  },

  // Supported community platforms — agent-reach, scrapling fallback.
  {
    match: hostEndsWith("reddit.com"),
    chain: { primary: "agent-reach", fallbacks: ["scrapling"] },
    rule: "community/reddit"
  },
  {
    match: hostEndsWith("x.com", "twitter.com"),
    chain: { primary: "agent-reach", fallbacks: ["scrapling"] },
    rule: "community/x"
  },
  {
    match: hostEndsWith("github.com"),
    chain: { primary: "agent-reach", fallbacks: ["scrapling"] },
    rule: "github"
  },
  {
    match: hostEndsWith("xiaohongshu.com"),
    chain: { primary: "agent-reach", fallbacks: ["scrapling"] },
    rule: "community/xhs"
  },

  // Korean community platforms — agent-reach doesn't handle these,
  // scrapling is primary. Listed explicitly so we don't accidentally route
  // them through agent-reach when it gets a "generic" handler later.
  {
    match: hostEndsWith(
      "dcinside.com",
      "arca.live",
      "clien.net",
      "fmkorea.com",
      "ppomppu.co.kr",
      "ruliweb.com",
      "inven.co.kr",
      "instiz.net",
      "theqoo.net",
      "mlbpark.donga.com"
    ),
    chain: { primary: "scrapling", fallbacks: [] },
    rule: "community/korean"
  },

  // PDF track — arxiv treated specially (we want structured metadata too),
  // then generic .pdf extension / content-type.
  {
    match: "arxiv",
    chain: { primary: "opendataloader-pdf", fallbacks: ["agent-reach"] },
    rule: "pdf/arxiv"
  },
  {
    match: "pdf-ext",
    chain: { primary: "opendataloader-pdf", fallbacks: ["markitdown"] },
    rule: "pdf/generic"
  }
];

/** Default when nothing else matches. */
const DEFAULT_CHAIN: AdapterChain = {
  primary: "scrapling",
  fallbacks: ["markitdown"],
  rule: "web/generic"
};

// ---- public API ---------------------------------------------------------

/**
 * Return the adapter chain for a URL. Always returns a chain — `scrapling`
 * is the generic fallback when no rule matches. For malformed URLs we still
 * return the default so callers don't have to handle null.
 */
export function routeUrl(url: string): AdapterChain {
  const pathname = safePathname(url);

  if (
    (hostnameOf(url) === "reddit.com" || hostnameOf(url) === "www.reddit.com") &&
    pathname === "/search.json"
  ) {
    return {
      primary: "community-search-json",
      fallbacks: ["agent-reach", "scrapling"],
      rule: "community/reddit-search-json"
    };
  }

  if (hostnameOf(url) === "hn.algolia.com" && pathname?.startsWith("/api/v1/search")) {
    return {
      primary: "community-search-json",
      fallbacks: [],
      rule: "aggregator/hn-algolia"
    };
  }

  if (isJinaReaderMirror(url)) {
    return { primary: "scrapling", fallbacks: ["markitdown"], rule: "web/public-mirror" };
  }

  if (isKnownPublicFeedUrl(url)) {
    return { primary: "scrapling", fallbacks: ["markitdown"], rule: "web/public-feed" };
  }

  const host = hostnameOf(url);

  for (const r of RULES) {
    if (r.match === "pdf-ext") {
      if (isPdfUrl(url)) return { ...r.chain, rule: r.rule };
      continue;
    }
    if (r.match === "arxiv") {
      if (isArxivUrl(url)) return { ...r.chain, rule: r.rule };
      continue;
    }
    if (host && r.match(host)) {
      return { ...r.chain, rule: r.rule };
    }
  }

  return DEFAULT_CHAIN;
}

/** True if the URL path suggests a PDF resource. */
export function isPdfUrl(url: string): boolean {
  const pathname = safePathname(url);
  if (!pathname) return false;
  return /\.pdf(?:$|[?#/])/i.test(pathname) || pathname.toLowerCase().endsWith(".pdf");
}

function isArxivUrl(url: string): boolean {
  const host = hostnameOf(url);
  if (host !== "arxiv.org" && host !== "www.arxiv.org") return false;
  const pathname = safePathname(url);
  if (!pathname) return false;
  return /^\/(abs|pdf)\//i.test(pathname);
}

function safePathname(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/** Expose rule count for diagnostic use (and to prevent dead-code pruning). */
export function ruleCount(): number {
  return RULES.length;
}
