import { normalizeRunInputs } from "@/lib/orchestrator/clarify";
import { expandQuery } from "@/lib/orchestrator/query-expansion";
import type { RunRecord } from "@/lib/storage/schema";
import type { KnowledgeContext, ResearchPlan, SourceTarget } from "@/lib/adapters/types";

function inferSourceTargets(record: RunRecord): SourceTarget[] {
  const targets: SourceTarget[] = ["web", "community"];

  if (record.run.input.urls.length > 0) {
    targets.push("video", "github");
  }

  return Array.from(new Set(targets));
}

export function planRun(
  record: RunRecord,
  kbContext: KnowledgeContext | null = null,
  options?: { now?: Date }
): ResearchPlan {
  const normalizedInput = normalizeRunInputs({
    title: record.run.title,
    naturalLanguage: record.run.input.naturalLanguage,
    pastedContent: record.run.input.pastedContent,
    urls: record.run.input.urls
  });
  const expansion = expandQuery(normalizedInput, {
    now: options?.now
  });
  const mergedUrls = Array.from(
    new Set([...normalizedInput.urls, ...expansion.expanded.map((entry) => entry.url)])
  );

  return {
    projectId: record.run.projectId,
    runId: record.run.id,
    title: record.run.title,
    mode: record.run.mode,
    normalizedInput: {
      ...normalizedInput,
      urls: mergedUrls
    },
    expansion,
    sourceTargets: inferSourceTargets(record),
    kbContext
  };
}

export type { ResearchPlan } from "@/lib/adapters/types";
