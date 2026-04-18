import type { RunMode } from "@/lib/domain/runs";
import type {
  ArtifactLanguage,
  BlockReason,
  BypassLevel,
  FetchStatus,
  SourceTier
} from "@/lib/domain/claims";
import type { NormalizedRunInput } from "@/lib/orchestrator/clarify";
import type { ExpansionResult } from "@/lib/orchestrator/query-expansion";

export type SourceTarget =
  | "web"
  | "community"
  | "video"
  | "github"
  | "geocoding"
  | "kb"
  | "pdf";

// Re-export fetcher outcome enums so adapter code has a single import surface.
export type { ArtifactLanguage, BlockReason, BypassLevel, FetchStatus };

// Reserved metadata keys. Enforced by convention (metadata is Record<string,string>),
// but every adapter MUST set METADATA_KEYS.FETCHER and FETCH_STATUS.
// BLOCK_REASON and BYPASS_LEVEL are populated when relevant.
export const METADATA_KEYS = {
  FETCHER: "fetcher",
  SOURCE_LABEL: "source_label",
  RATE_LIMIT_BUCKET: "rate_limit_bucket",
  FETCH_STATUS: "fetch_status",
  BLOCK_REASON: "block_reason",
  BYPASS_LEVEL: "bypass_level",
  OCR: "ocr",
  LOGIN_REQUIRED: "login_required"
} as const;

export type MetadataKey = (typeof METADATA_KEYS)[keyof typeof METADATA_KEYS];

export type KnowledgeContextNote = {
  title: string;
  path: string;
  summary: string;
  reusableClaims: string[];
};

export type KnowledgeContext = {
  operatorNotes: KnowledgeContextNote[];
  wikiNotes: KnowledgeContextNote[];
  priorDecisions: Array<{
    runId: string;
    title: string;
    decision: "go" | "no_go" | "unclear";
    why: string;
    createdAt: string;
  }>;
  queryExpansion: string[];
  duplicateWarnings: string[];
  freshEvidenceFocus: string[];
};

export type ResearchPlan = {
  projectId: string;
  runId: string;
  title: string;
  mode: RunMode;
  normalizedInput: NormalizedRunInput;
  expansion?: ExpansionResult | null;
  sourceTargets: SourceTarget[];
  kbContext: KnowledgeContext | null;
};

export type SourcePriority = "official" | "primary_data" | "analysis" | "community";

export type SourceArtifact = {
  id: string;
  /** Adapter / fetcher name. Doubles as the authoritative fetcher identity. */
  adapter: string;
  sourceType: SourceTarget;
  title: string;
  /** Original URL as received. Kept for backward compat with persisted runs. */
  url: string;
  /**
   * Canonical form of url. Produced by lib/adapters/url.ts `canonicalize()`.
   * Optional in PR 1 for migration; adapters must populate from PR 2 onward.
   */
  canonicalUrl?: string;
  snippet: string;
  content: string;
  sourcePriority: SourcePriority;
  sourceTier?: SourceTier;
  /** ISO8601 timestamp the artifact was fetched. Basis for freshness / TTL. */
  retrievedAt?: string;
  /** Artifact language. `unknown` permitted until language detection lands. */
  language?: ArtifactLanguage;
  /** Adapter's self-reported confidence in this fetch (0..1). */
  confidence?: number;
  /** Workspace-relative path to raw payload file. Required from PR 3. */
  rawRef?: string;
  publishedAt?: string;
  metadata: Record<string, string>;
};

export type ResearchAdapter = {
  name: string;
  supports: (plan: ResearchPlan) => boolean;
  execute: (plan: ResearchPlan) => Promise<SourceArtifact[]>;
};
