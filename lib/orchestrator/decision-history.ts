import type { Project } from "@/lib/domain/projects";
import type { RunRecord } from "@/lib/storage/schema";

export type DecisionHistoryItem = {
  runId: string;
  createdAt: string;
  mode: RunRecord["run"]["mode"];
  decision: NonNullable<RunRecord["decision"]>["value"];
  confidence: NonNullable<RunRecord["decision"]>["confidence"];
  why: NonNullable<RunRecord["decision"]>["why"];
  blockingUnknownCount: number;
};

export function buildDecisionHistory(
  _project: Project,
  runs: RunRecord[]
): DecisionHistoryItem[] {
  return runs
    .filter((record) => record.run.status === "decided" && !!record.decision)
    .map((record) => ({
      runId: record.run.id,
      createdAt: record.run.createdAt,
      mode: record.run.mode,
      decision: record.decision!.value,
      confidence: record.decision!.confidence,
      why: record.decision!.why,
      blockingUnknownCount: record.decision?.blockingUnknowns.length ?? 0
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
