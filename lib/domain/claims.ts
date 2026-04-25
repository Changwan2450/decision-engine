import { z } from "zod";

export const sourceTargetSchema = z.enum([
  "web",
  "community",
  "video",
  "github",
  "geocoding",
  "kb",
  "pdf"
]);

export const sourcePrioritySchema = z.enum([
  "official",
  "primary_data",
  "analysis",
  "community"
]);

export const sourceTierSchema = z.enum([
  "official",
  "primary",
  "internal",
  "community",
  "aggregator",
  "unknown"
]);

export const trustTierSchema = z.enum([
  "high",
  "medium",
  "low"
]);

// ---- Fetcher outcome enums (Milestone 1 / PR 1) -------------------------
// Every adapter should populate metadata.fetch_status. block_reason and
// bypass_level are populated when relevant (blocked fetchers, protected sites).
export const fetchStatusSchema = z.enum([
  "success",
  "partial",
  "blocked",
  "timeout",
  "error"
]);

export const blockReasonSchema = z.enum([
  "turnstile",
  "login",
  "geo",
  "captcha",
  "ratelimit",
  "unknown"
]);

export const bypassLevelSchema = z.enum([
  "none",
  "headers",
  "tls",
  "turnstile",
  "headless"
]);

export const artifactLanguageSchema = z.enum([
  "ko",
  "en",
  "zh",
  "ja",
  "unknown"
]);

// sourceArtifactSchema
//
// PR 1 additions (all optional so existing persisted data still validates):
//   canonicalUrl  — normalized form of url, produced by lib/adapters/url.ts.
//                   adapters must populate this from PR 2 onward.
//   retrievedAt   — ISO8601 timestamp the artifact was fetched. basis for
//                   freshness & cache TTL.
//   language      — used by synthesis to route language-aware processing.
//   confidence    — 0..1, adapter's own confidence the fetch is clean/complete.
//   rawRef        — workspace-relative path to raw payload (set by PR 3
//                   raw-store). enables citation grounding and re-processing.
export const sourceArtifactSchema = z.object({
  id: z.string().min(1),
  adapter: z.string().min(1),
  sourceType: sourceTargetSchema,
  title: z.string().min(1),
  url: z.string().url(),
  canonicalUrl: z.string().optional(),
  snippet: z.string(),
  content: z.string(),
  sourcePriority: sourcePrioritySchema,
  sourceTier: sourceTierSchema.optional(),
  retrievedAt: z.string().datetime().optional(),
  language: artifactLanguageSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  rawRef: z.string().optional(),
  publishedAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.string())
});

export const citationSchema = z.object({
  id: z.string().min(1),
  artifactId: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  priority: sourcePrioritySchema,
  sourceTier: sourceTierSchema.optional(),
  trustTier: trustTierSchema.optional(),
  retrievedAt: z.string().datetime().optional(),
  publishedAt: z.string().datetime().optional()
});

export const claimProvenanceSchema = z.object({
  sourcePriority: sourcePrioritySchema,
  sourceTier: sourceTierSchema.optional(),
  trustTier: trustTierSchema,
  citationCount: z.number().int().positive(),
  observedAt: z.string().datetime().optional(),
  artifactTitle: z.string().min(1).optional(),
  artifactUrl: z.string().url().optional()
});

export const claimSchema = z.object({
  id: z.string().min(1),
  artifactId: z.string().min(1),
  text: z.string().min(1),
  topicKey: z.string().min(1).optional(),
  stance: z.enum(["support", "oppose", "neutral"]).default("neutral"),
  citationIds: z.array(z.string().min(1)).min(1),
  sourceTier: sourceTierSchema.optional(),
  trustTier: trustTierSchema.optional(),
  observedAt: z.string().datetime().optional(),
  provenance: claimProvenanceSchema.optional()
});

export const contradictionKindSchema = z.enum([
  "internal_vs_community",
  "internal_vs_official",
  "internal_vs_primary",
  "official_vs_community",
  "primary_vs_community",
  "aggregator_only",
  "community_only",
  "mixed"
]);

export const contradictionSchema = z.object({
  id: z.string().min(1),
  claimIds: z.array(z.string().min(1)).length(2),
  status: z.enum(["flagged", "reviewed"]).default("flagged"),
  resolution: z.enum(["unresolved", "accepted", "dismissed"]).default("unresolved"),
  kind: contradictionKindSchema.optional(),
  tierA: sourceTierSchema.optional(),
  tierB: sourceTierSchema.optional()
});

export const evidenceSummarySchema = z.object({
  shouldRemainUnclear: z.boolean(),
  reasons: z.array(
    z.enum([
      "contradiction_detected",
      "recency_gap",
      "insufficient_high_priority_support"
    ])
  ),
  highestPrioritySeen: sourcePrioritySchema.nullable(),
  decisiveEvidenceScore: z.number().min(0).max(1).optional(),
  falseConvergenceRisk: z.boolean().optional(),
  convergenceRiskReasons: z.array(z.string()).optional(),
  counterevidenceChecked: z.boolean().optional(),
  supportOnlyEvidence: z.boolean().optional(),
  weakEvidence: z.boolean().optional(),
  sourcePriorityCounts: z.object({
    official: z.number(),
    primary_data: z.number(),
    analysis: z.number(),
    community: z.number()
  }).optional(),
  sourceTierCounts: z.object({
    official: z.number(),
    primary: z.number(),
    internal: z.number(),
    community: z.number(),
    aggregator: z.number(),
    unknown: z.number()
  }).optional(),
  sourcePriorityDiversity: z.number().optional(),
  hasOfficialOrPrimaryEvidence: z.boolean().optional(),
  aggregatorOnlyEvidence: z.boolean().optional(),
  sourceCoverageWarnings: z.array(z.string()).optional(),
  claimCount: z.number().int().nonnegative(),
  contradictionCount: z.number().int().nonnegative()
});

export type SourceArtifactRecord = z.infer<typeof sourceArtifactSchema>;
export type SourceTier = z.infer<typeof sourceTierSchema>;
export type TrustTier = z.infer<typeof trustTierSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type ContradictionKind = z.infer<typeof contradictionKindSchema>;
export type Contradiction = z.infer<typeof contradictionSchema>;
export type EvidenceSummary = z.infer<typeof evidenceSummarySchema>;
export type FetchStatus = z.infer<typeof fetchStatusSchema>;
export type BlockReason = z.infer<typeof blockReasonSchema>;
export type BypassLevel = z.infer<typeof bypassLevelSchema>;
export type ArtifactLanguage = z.infer<typeof artifactLanguageSchema>;
