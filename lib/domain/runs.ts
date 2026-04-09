import { z } from "zod";

export const runModeSchema = z.enum(["quick", "standard", "deep"]);
export type RunMode = z.infer<typeof runModeSchema>;

export const runStatusSchema = z.enum([
  "draft",
  "awaiting_clarification",
  "collecting",
  "synthesizing",
  "decided",
  "failed"
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runInputSchema = z.object({
  naturalLanguage: z.string().optional(),
  pastedContent: z.string().optional(),
  urls: z.array(z.string().url()).default([])
});
export type RunInput = z.infer<typeof runInputSchema>;

export const runSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  mode: runModeSchema,
  status: runStatusSchema,
  clarificationQuestions: z.array(z.string()).default([]),
  input: runInputSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type Run = z.infer<typeof runSchema>;

const allowedTransitions: Record<RunStatus, RunStatus[]> = {
  draft: ["awaiting_clarification", "collecting", "failed"],
  awaiting_clarification: ["collecting", "failed"],
  collecting: ["synthesizing", "failed"],
  synthesizing: ["decided", "failed"],
  decided: [],
  failed: []
};

export function assertRunTransition(current: RunStatus, next: RunStatus): void {
  if (!allowedTransitions[current].includes(next)) {
    throw new Error(`Invalid run transition: ${current} -> ${next}`);
  }
}

export function createRun(input: {
  id: string;
  projectId: string;
  title: string;
  mode?: RunMode;
  status?: RunStatus;
  naturalLanguage?: string;
  pastedContent?: string;
  urls?: string[];
  now: string;
}): Run {
  return runSchema.parse({
    id: input.id,
    projectId: input.projectId,
    title: input.title,
    mode: input.mode ?? "standard",
    status: input.status ?? "draft",
    clarificationQuestions: [],
    input: {
      naturalLanguage: input.naturalLanguage,
      pastedContent: input.pastedContent,
      urls: input.urls ?? []
    },
    createdAt: input.now,
    updatedAt: input.now
  });
}
