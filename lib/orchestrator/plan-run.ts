import { normalizeRunInputs } from "@/lib/orchestrator/clarify";
import type { RunRecord } from "@/lib/storage/schema";
import type { ResearchPlan, SourceTarget } from "@/lib/adapters/types";

function inferSourceTargets(record: RunRecord): SourceTarget[] {
  const targets: SourceTarget[] = ["web", "community"];

  if (record.run.input.urls.length > 0) {
    targets.push("video", "github");
  }

  return Array.from(new Set(targets));
}

export function planRun(record: RunRecord): ResearchPlan {
  const normalizedInput = normalizeRunInputs({
    title: record.run.title,
    naturalLanguage: record.run.input.naturalLanguage,
    pastedContent: record.run.input.pastedContent,
    urls: record.run.input.urls
  });

  return {
    projectId: record.run.projectId,
    runId: record.run.id,
    title: record.run.title,
    mode: record.run.mode,
    normalizedInput,
    sourceTargets: inferSourceTargets(record)
  };
}

export type { ResearchPlan } from "@/lib/adapters/types";
