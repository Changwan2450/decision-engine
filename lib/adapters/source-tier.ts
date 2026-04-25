import type { SourceTier } from "@/lib/domain/claims";

const INTERNAL_HOSTS = new Set([
  "kb.local"
]);

const AGGREGATOR_HOSTS = new Set([
  "s.jina.ai",
  "r.jina.ai"
]);

const COMMUNITY_HOSTS = new Set([
  "www.reddit.com",
  "old.reddit.com",
  "reddit.com",
  "hn.algolia.com",
  "news.ycombinator.com"
]);

const OFFICIAL_HOSTS = new Set<string>([
  "postgresql.org",
  "www.postgresql.org",
  "opentelemetry.io",
  "www.opentelemetry.io",
  "openai.com",
  "anthropic.com"
]);

const PRIMARY_HOSTS = new Set<string>([
  "arxiv.org",
  "acm.org"
]);

function matchesKnownHost(host: string, knownHosts: Set<string>): boolean {
  if (knownHosts.has(host)) return true;

  for (const knownHost of knownHosts) {
    if (host.endsWith(`.${knownHost}`)) {
      return true;
    }
  }

  return false;
}

export function inferSourceTier(url: string): SourceTier {
  try {
    const host = new URL(url).hostname.toLowerCase();

    if (INTERNAL_HOSTS.has(host)) return "internal";
    if (matchesKnownHost(host, OFFICIAL_HOSTS)) return "official";
    if (matchesKnownHost(host, PRIMARY_HOSTS)) return "primary";
    if (AGGREGATOR_HOSTS.has(host)) return "aggregator";
    if (COMMUNITY_HOSTS.has(host)) return "community";
    if (host.endsWith(".reddit.com")) return "community";

    return "unknown";
  } catch {
    return "unknown";
  }
}
