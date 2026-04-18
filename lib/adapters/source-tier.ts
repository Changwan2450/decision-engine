import type { SourceTier } from "@/lib/domain/claims";

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

const OFFICIAL_HOSTS = new Set<string>([]);

const PRIMARY_HOSTS = new Set<string>([]);

export function inferSourceTier(url: string): SourceTier {
  try {
    const host = new URL(url).hostname.toLowerCase();

    if (OFFICIAL_HOSTS.has(host)) return "official";
    if (PRIMARY_HOSTS.has(host)) return "primary";
    if (AGGREGATOR_HOSTS.has(host)) return "aggregator";
    if (COMMUNITY_HOSTS.has(host)) return "community";
    if (host.endsWith(".reddit.com")) return "community";

    return "unknown";
  } catch {
    return "unknown";
  }
}
