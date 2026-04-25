import { z } from "zod";

export const PackV1Schema = z.object({
  packId: z.literal("pack-001"),
  packVersion: z.string().min(1),
  sealed: z.literal(true).default(true),
  auditMode: z.string().min(1),
  optionalExternalApiAudit: z.boolean(),
  topicCount: z.literal(16),
  halfSplit: z.object({
    devObserved: z.literal(8),
    sealedAudit: z.literal(8)
  }),
  refs: z.object({
    discipline: z.string().min(1),
    spec: z.string().min(1),
    handoffShape: z.string().min(1),
    promptTemplate: z.string().min(1)
  }),
  acceptanceSchema: z.object({
    requiredSourceClassesAnyOf: z.string().min(1),
    requiredSourceClassesAllOf: z.string().min(1),
    forbiddenSourcePatterns: z.string().min(1),
    minUsableClaims: z.string().min(1),
    maxFalseConvergenceSignals: z.string().min(1),
    allowAbstain: z.string().min(1)
  }),
  topics: z.array(
    z.object({
      id: z.string().min(1),
      half: z.enum(["DEV-OBSERVED", "SEALED-AUDIT"]),
      query: z.string().min(1),
      axes: z.object({
        language: z.enum(["en", "ko", "mixed"]),
        genre: z.enum(["official-rich", "official-sparse", "experience-only"]),
        recency: z.enum(["static", "recent-6mo"]),
        disputedness: z.enum(["consensual", "disputed"]),
        "doc-density": z.enum(["dense", "sparse"])
      }),
      acceptance: z.object({
        requiredSourceClassesAnyOf: z.array(z.string()),
        requiredSourceClassesAllOf: z.array(z.string()),
        forbiddenSourcePatterns: z.array(z.string()),
        minUsableClaims: z.number().int().nonnegative(),
        maxFalseConvergenceSignals: z.number().int().nonnegative(),
        allowAbstain: z.boolean()
      }),
      rationale: z.string().min(1)
    })
  ).length(16)
});

export type PackV1 = z.infer<typeof PackV1Schema>;

export const PackV2DraftSchema = z.object({
  packId: z.literal("pack-002"),
  packVersion: z.string().min(1),
  sealed: z.literal(false),
  auditMode: z.null(),
  topicCount: z.number().int().positive(),
  refs: z.object({
    discipline: z.string().min(1),
    spec: z.string().min(1)
  }),
  status: z.object({
    phase: z.string().min(1),
    note: z.string().min(1)
  }),
  acceptance_fields: z.object({
    required_source_classes: z.string().min(1),
    forbidden_source_patterns: z.string().min(1),
    min_decisive_evidence_score: z.string().min(1),
    require_counterevidence_check: z.string().min(1),
    require_unresolved_questions_when_weak: z.string().min(1),
    n_plus_one_reuse_expected: z.string().min(1)
  }),
  cases: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      failure_mode: z.string().min(1),
      scenario: z.string().min(1),
      expected_behavior: z.string().min(1),
      acceptance: z.object({
        required_source_classes: z.array(z.string().min(1)).nonempty(),
        forbidden_source_patterns: z.array(z.string()),
        min_decisive_evidence_score: z.number().min(0).max(1),
        require_counterevidence_check: z.boolean(),
        require_unresolved_questions_when_weak: z.boolean(),
        n_plus_one_reuse_expected: z.boolean()
      }),
      blocker_conditions: z.array(z.string().min(1))
    })
  ).nonempty()
});

export type PackV2Draft = z.infer<typeof PackV2DraftSchema>;
