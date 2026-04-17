// Shared fetch-outcome contract for all adapters.
//
// Every adapter produces SourceArtifact objects whose `metadata` MUST contain
// a consistent set of keys so DuckDB aggregations and the router's fallback
// logic (PR 4) can read the same fields regardless of which adapter fetched.
//
// Done conditions for PR 2 (per design doc §4.1, §8.2):
//   - fetch_status is ALWAYS set (success / partial / blocked / timeout / error)
//   - block_reason is ALWAYS set ("unknown" is the default, never empty)
//   - bypass_level is ALWAYS set ("none" is the default)
//   - login_required is ALWAYS set ("true" | "false" string)
//   - adapters NEVER throw out of execute(); exceptions are absorbed into
//     a failure artifact so the router can still see "this URL was attempted".
//
// This module is pure (no IO) so it can be imported from any adapter without
// pulling in fetcher dependencies.
//
// PR 1 shipped the enums (lib/domain/claims.ts) and METADATA_KEYS constant
// (lib/adapters/types.ts). PR 2 makes them actually enforced at the adapter
// boundary via the helpers below.

import type {
  ArtifactLanguage,
  BlockReason,
  BypassLevel,
  FetchStatus
} from "@/lib/domain/claims";
import { METADATA_KEYS } from "@/lib/adapters/types";
import type {
  SourceArtifact,
  SourcePriority,
  SourceTarget
} from "@/lib/adapters/types";

/** Structured outcome of a single fetch attempt. */
export type FetchOutcome = {
  status: FetchStatus;
  /** Populated whenever status is blocked; "unknown" otherwise. */
  blockReason?: BlockReason;
  /** Populated whenever a bypass was attempted; "none" otherwise. */
  bypassLevel?: BypassLevel;
  /** Whether the resource required an authenticated session. Default: false. */
  loginRequired?: boolean;
};

/** Default, non-empty values so downstream aggregations never see holes. */
const DEFAULT_BLOCK_REASON: BlockReason = "unknown";
const DEFAULT_BYPASS_LEVEL: BypassLevel = "none";

/**
 * Build the metadata block every adapter must set. fetch_status,
 * block_reason, bypass_level, login_required are always populated with
 * non-empty values, even on success / unknown / N-A paths. Adapter-specific
 * keys can be added via `extra` — they will not override reserved keys.
 */
export function buildFetchMetadata(opts: {
  fetcher: string;
  outcome: FetchOutcome;
  sourceLabel?: string;
  rateLimitBucket?: string;
  extra?: Record<string, string | undefined>;
}): Record<string, string> {
  const base: Record<string, string> = {};

  // Populate extra first so reserved keys win on collision.
  if (opts.extra) {
    for (const [key, value] of Object.entries(opts.extra)) {
      if (typeof value === "string" && value.length > 0) base[key] = value;
    }
  }

  base[METADATA_KEYS.FETCHER] = opts.fetcher;
  base[METADATA_KEYS.FETCH_STATUS] = opts.outcome.status;
  base[METADATA_KEYS.BLOCK_REASON] =
    opts.outcome.blockReason ?? DEFAULT_BLOCK_REASON;
  base[METADATA_KEYS.BYPASS_LEVEL] =
    opts.outcome.bypassLevel ?? DEFAULT_BYPASS_LEVEL;
  base[METADATA_KEYS.LOGIN_REQUIRED] = (opts.outcome.loginRequired ?? false)
    ? "true"
    : "false";

  if (opts.sourceLabel) base[METADATA_KEYS.SOURCE_LABEL] = opts.sourceLabel;
  if (opts.rateLimitBucket)
    base[METADATA_KEYS.RATE_LIMIT_BUCKET] = opts.rateLimitBucket;

  return base;
}

/**
 * Conservative confidence score derived from fetch status. Adapters can
 * override by passing `confidence` to buildArtifact — this is just the floor.
 */
export function confidenceFromStatus(status: FetchStatus): number {
  switch (status) {
    case "success":
      return 0.85;
    case "partial":
      return 0.5;
    case "blocked":
    case "timeout":
    case "error":
      return 0.0;
  }
}

/**
 * Assemble a SourceArtifact, enforcing the metadata contract. Never throws.
 * Required fields get sensible defaults so downstream zod validation always
 * passes (empty title is replaced with a placeholder derived from url).
 */
export function buildArtifact(params: {
  id: string;
  adapter: string;
  sourceType: SourceTarget;
  url: string;
  canonicalUrl?: string;
  title?: string;
  snippet?: string;
  content?: string;
  sourcePriority?: SourcePriority;
  retrievedAt?: string;
  publishedAt?: string;
  language?: ArtifactLanguage;
  confidence?: number;
  rawRef?: string;
  outcome: FetchOutcome;
  fetcher: string;
  sourceLabel?: string;
  rateLimitBucket?: string;
  extra?: Record<string, string | undefined>;
}): SourceArtifact {
  const title = (params.title ?? "").trim() || deriveTitleFromUrl(params.url);
  const snippet = (params.snippet ?? "").trim();
  const content = params.content ?? "";
  const confidence =
    typeof params.confidence === "number"
      ? clamp01(params.confidence)
      : confidenceFromStatus(params.outcome.status);

  const metadata = buildFetchMetadata({
    fetcher: params.fetcher,
    outcome: params.outcome,
    sourceLabel: params.sourceLabel,
    rateLimitBucket: params.rateLimitBucket,
    extra: params.extra
  });

  const artifact: SourceArtifact = {
    id: params.id,
    adapter: params.adapter,
    sourceType: params.sourceType,
    title,
    url: params.url,
    snippet,
    content,
    sourcePriority: params.sourcePriority ?? "analysis",
    metadata
  };

  if (params.canonicalUrl) artifact.canonicalUrl = params.canonicalUrl;
  if (params.retrievedAt) artifact.retrievedAt = params.retrievedAt;
  if (params.publishedAt) artifact.publishedAt = params.publishedAt;
  if (params.language) artifact.language = params.language;
  if (typeof confidence === "number") artifact.confidence = confidence;
  if (params.rawRef) artifact.rawRef = params.rawRef;

  return artifact;
}

/**
 * Produce a failure stub artifact when a fetch attempt never yielded content.
 * Still carries the URL (so fallback logic can retry) and the full metadata
 * contract. Callers should NOT filter these out — downstream needs to see
 * what was attempted.
 */
export function buildFailureArtifact(params: {
  id: string;
  adapter: string;
  fetcher: string;
  url: string;
  sourceType: SourceTarget;
  outcome: FetchOutcome;
  errorMessage?: string;
  sourceLabel?: string;
  retrievedAt?: string;
}): SourceArtifact {
  return buildArtifact({
    id: params.id,
    adapter: params.adapter,
    fetcher: params.fetcher,
    sourceType: params.sourceType,
    url: params.url,
    outcome: params.outcome,
    sourceLabel: params.sourceLabel,
    retrievedAt: params.retrievedAt,
    title: deriveTitleFromUrl(params.url),
    snippet: "",
    content: "",
    extra: params.errorMessage
      ? { error: truncate(params.errorMessage, 500) }
      : undefined
  });
}

/** Strict check that a metadata block honors the contract. Used by tests. */
export function assertMetadataContract(
  metadata: Record<string, string>
): asserts metadata is Record<string, string> {
  for (const key of REQUIRED_METADATA_KEYS) {
    const value = metadata[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`metadata contract violation: missing ${key}`);
    }
  }
}

export const REQUIRED_METADATA_KEYS: readonly string[] = [
  METADATA_KEYS.FETCHER,
  METADATA_KEYS.FETCH_STATUS,
  METADATA_KEYS.BLOCK_REASON,
  METADATA_KEYS.BYPASS_LEVEL,
  METADATA_KEYS.LOGIN_REQUIRED
] as const;

// ---- helpers -----------------------------------------------------------

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function truncateErrorMessage(s: string, max = 500): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}

function truncate(s: string, max: number): string {
  return truncateErrorMessage(s, max);
}

export function deriveTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const lastSeg = u.pathname.split("/").filter(Boolean).pop();
    if (lastSeg) return `${u.hostname}/${decodeURIComponent(lastSeg)}`;
    return u.hostname;
  } catch {
    return url.slice(0, 80) || "untitled";
  }
}
