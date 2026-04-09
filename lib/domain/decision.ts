import { z } from "zod";

export const decisionValueSchema = z.enum(["go", "no_go", "unclear"]);
export const confidenceSchema = z.enum(["low", "medium", "high"]);

export const decisionSchema = z.object({
  value: decisionValueSchema,
  why: z.string().min(1),
  confidence: confidenceSchema,
  blockingUnknowns: z.array(z.string()),
  nextActions: z.array(z.string())
});

export const prdSeedSchema = z.object({
  targetUser: z.string().min(1),
  problem: z.string().min(1),
  solutionHypothesis: z.string().min(1),
  featureCandidates: z.array(z.string()).min(1),
  risk: z.array(z.string()).min(1)
});

export type Decision = z.infer<typeof decisionSchema>;
export type PrdSeed = z.infer<typeof prdSeedSchema>;
