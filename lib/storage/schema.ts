import { z } from "zod";
import {
  claimSchema,
  citationSchema,
  contradictionSchema,
  evidenceSummarySchema,
  sourceArtifactSchema
} from "@/lib/domain/claims";
import { decisionSchema, prdSeedSchema } from "@/lib/domain/decision";
import { projectSchema } from "@/lib/domain/projects";
import { runSchema } from "@/lib/domain/runs";
import type { ExpansionAxis, ExpandedSource } from "@/lib/orchestrator/query-expansion";

export const normalizedRunInputSchema = z.object({
  title: z.string().min(1),
  naturalLanguage: z.string(),
  pastedContent: z.string(),
  urls: z.array(z.string().url()),
  goal: z.string().optional(),
  target: z.string().optional(),
  comparisonAxis: z.string().optional()
});

export const knowledgeContextNoteSchema = z.object({
  title: z.string().min(1),
  path: z.string().min(1),
  summary: z.string(),
  reusableClaims: z.array(z.string()).default([])
});

export const knowledgeContextSchema = z.object({
  operatorNotes: z.array(knowledgeContextNoteSchema).default([]),
  wikiNotes: z.array(knowledgeContextNoteSchema).default([]),
  priorDecisions: z.array(
    z.object({
      runId: z.string().min(1),
      title: z.string().min(1),
      decision: z.enum(["go", "no_go", "unclear"]),
      why: z.string().min(1),
      createdAt: z.string().datetime()
    })
  ).default([]),
  queryExpansion: z.array(z.string()).default([]),
  duplicateWarnings: z.array(z.string()).default([]),
  freshEvidenceFocus: z.array(z.string()).default([])
});

export const expandedQuerySchema = z.object({
  axis: z.custom<ExpansionAxis>((value) =>
    value === "official" ||
    value === "recent" ||
    value === "comparison" ||
    value === "counter"
  ),
  query: z.string().min(1),
  source: z.custom<ExpandedSource>((value) =>
    value === "jina-search" || value === "reddit-search" || value === "hn-algolia"
  ),
  url: z.string().url()
});

export const expansionResultSchema = z.object({
  expanded: z.array(expandedQuerySchema).default([]),
  dropped: z.number().int().nonnegative().default(0)
});

export const projectInsightSchema = z.object({
  repeatedProblems: z.array(z.string()).default([]),
  repeatedPatterns: z.array(z.string()).default([]),
  competitorSignals: z.array(z.string()).default([]),
  contradictionIds: z.array(z.string()).default([])
});

export const promotionCandidateSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["repeated_problem", "repeated_pattern", "competitor_signal"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  sourceRunIds: z.array(z.string().min(1)).min(1),
  status: z.enum(["suggested", "approved", "rejected"]),
  reason: z.string().min(1)
});

export const watchQuerySchema = z.object({
  naturalLanguage: z.string().optional(),
  urls: z.array(z.string().url()).default([])
});

export const watchSourceFilterSchema = z.object({
  includeAdapters: z.array(z.string()).default([]),
  excludeAdapters: z.array(z.string()).default([]),
  includeDomains: z.array(z.string()).default([]),
  sourceTypes: z.array(z.string()).default([])
});

export const watchDeliverySchema = z.object({
  digest: z.boolean().default(true),
  alert: z.boolean().default(false),
  inbox: z.boolean().default(true)
});

export const watchScheduleSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("interval"),
      intervalMs: z.number().int().positive()
    })
  ])
  .nullable()
  .default(null);

export const watchTargetSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  query: watchQuerySchema,
  sourceFilter: watchSourceFilterSchema.default({
    includeAdapters: [],
    excludeAdapters: [],
    includeDomains: [],
    sourceTypes: []
  }),
  delivery: watchDeliverySchema.default({
    digest: true,
    alert: false,
    inbox: true
  }),
  tags: z.array(z.string()).default([]),
  status: z.enum(["draft", "active", "paused", "archived"]),
  schedule: watchScheduleSchema,
  lastTriggeredAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const digestSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  watchTargetId: z.string().min(1),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  sourceRunIds: z.array(z.string().min(1)).default([]),
  headline: z.string().min(1),
  summary: z.string(),
  status: z.enum(["pending", "built", "delivered", "acted_on", "ignored"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const inboxItemSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  kind: z.enum(["digest", "alert", "novelty_note"]),
  refId: z.string().min(1),
  watchTargetId: z.string().min(1).optional(),
  status: z.enum(["unread", "read", "archived", "promoted"]),
  promotedRunId: z.string().min(1).nullable().optional(),
  title: z.string().min(1),
  summary: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const watchContextSchema = z.object({
  watchTargetId: z.string().min(1),
  triggerId: z.string().min(1).optional(),
  digestId: z.string().min(1).nullable().optional()
});

export const projectOriginSchema = z.object({
  source: z.literal("watch_digest"),
  watchTargetId: z.string().min(1),
  digestId: z.string().min(1),
  inboxItemId: z.string().min(1),
  sourceRunIds: z.array(z.string().min(1)).default([])
});

export const projectRecordSchema = z.object({
  project: projectSchema,
  insights: projectInsightSchema.default({
    repeatedProblems: [],
    repeatedPatterns: [],
    competitorSignals: [],
    contradictionIds: []
  }),
  promotionCandidates: z.array(promotionCandidateSchema).default([])
});

export const runRecordSchema = z.object({
  run: runSchema,
  watchContext: watchContextSchema.nullable().default(null),
  projectOrigin: projectOriginSchema.nullable().default(null),
  normalizedInput: normalizedRunInputSchema.nullable().default(null),
  expansion: expansionResultSchema.nullable().default(null),
  kbContext: knowledgeContextSchema.nullable().default(null),
  decision: decisionSchema.nullable().default(null),
  prdSeed: prdSeedSchema.nullable().default(null),
  artifacts: z.array(sourceArtifactSchema).default([]),
  claims: z.array(claimSchema).default([]),
  citations: z.array(citationSchema).default([]),
  contradictions: z.array(contradictionSchema).default([]),
  evidenceSummary: evidenceSummarySchema
    .nullable()
    .default(null),
  advisory: z
    .object({
      externalSummary: z.string(),
      suggestedNextActions: z.array(z.string()),
      notes: z.array(z.string()),
      provider: z.enum(["claude", "codex"]),
      mode: z.enum(["prompt_only", "cli_execute"]).optional(),
      ingestedAt: z.string().datetime(),
      executedAt: z.string().datetime().optional(),
      success: z.boolean().optional(),
      schemaVersion: z.literal("cli-bridge-v1")
    })
    .nullable()
    .default(null)
});

export type ProjectRecord = z.infer<typeof projectRecordSchema>;
export type RunRecord = z.infer<typeof runRecordSchema>;
export type WatchTargetRecord = z.infer<typeof watchTargetSchema>;
export type DigestRecord = z.infer<typeof digestSchema>;
export type InboxItemRecord = z.infer<typeof inboxItemSchema>;
