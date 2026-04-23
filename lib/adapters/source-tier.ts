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
  "www.opentelemetry.io"
]);

const PRIMARY_HOSTS = new Set<string>([]);

export function inferSourceTier(url: string): SourceTier {
  try {
    const host = new URL(url).hostname.toLowerCase();

    if (INTERNAL_HOSTS.has(host)) return "internal";
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
