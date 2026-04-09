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

export const normalizedRunInputSchema = z.object({
  title: z.string().min(1),
  naturalLanguage: z.string(),
  pastedContent: z.string(),
  urls: z.array(z.string().url()),
  goal: z.string().optional(),
  target: z.string().optional(),
  comparisonAxis: z.string().optional()
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
  normalizedInput: normalizedRunInputSchema.nullable().default(null),
  decision: decisionSchema.nullable().default(null),
  prdSeed: prdSeedSchema.nullable().default(null),
  artifacts: z.array(sourceArtifactSchema).default([]),
  claims: z.array(claimSchema).default([]),
  citations: z.array(citationSchema).default([]),
  contradictions: z.array(contradictionSchema).default([]),
  evidenceSummary: evidenceSummarySchema
    .nullable()
    .default(null)
});

export type ProjectRecord = z.infer<typeof projectRecordSchema>;
export type RunRecord = z.infer<typeof runRecordSchema>;
