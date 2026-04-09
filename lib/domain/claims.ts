import { z } from "zod";

export const sourceTargetSchema = z.enum([
  "web",
  "community",
  "video",
  "github",
  "geocoding"
]);

export const sourcePrioritySchema = z.enum([
  "official",
  "primary_data",
  "analysis",
  "community"
]);

export const sourceArtifactSchema = z.object({
  id: z.string().min(1),
  adapter: z.string().min(1),
  sourceType: sourceTargetSchema,
  title: z.string().min(1),
  url: z.string().url(),
  snippet: z.string(),
  content: z.string(),
  sourcePriority: sourcePrioritySchema,
  publishedAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.string())
});

export const citationSchema = z.object({
  id: z.string().min(1),
  artifactId: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  priority: sourcePrioritySchema,
  publishedAt: z.string().datetime().optional()
});

export const claimSchema = z.object({
  id: z.string().min(1),
  artifactId: z.string().min(1),
  text: z.string().min(1),
  topicKey: z.string().min(1).optional(),
  stance: z.enum(["support", "oppose", "neutral"]).default("neutral"),
  citationIds: z.array(z.string().min(1)).min(1)
});

export const contradictionSchema = z.object({
  id: z.string().min(1),
  claimIds: z.array(z.string().min(1)).length(2),
  status: z.enum(["flagged", "reviewed"]).default("flagged"),
  resolution: z.enum(["unresolved", "accepted", "dismissed"]).default("unresolved")
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
  claimCount: z.number().int().nonnegative(),
  contradictionCount: z.number().int().nonnegative()
});

export type SourceArtifactRecord = z.infer<typeof sourceArtifactSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type Contradiction = z.infer<typeof contradictionSchema>;
export type EvidenceSummary = z.infer<typeof evidenceSummarySchema>;
