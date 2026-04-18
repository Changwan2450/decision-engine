import { triggerWatchTarget } from "@/lib/orchestrator/watch-runtime";
import type { WatchTargetRecord } from "@/lib/storage/schema";
import {
  listProjectRecords,
  listWatchTargetRecords
} from "@/lib/storage/workspace";

type SchedulerSkipReason = "paused" | "no_schedule" | "not_due" | "error";

export function isWatchTargetDue(target: WatchTargetRecord, now: string): boolean {
  if (target.status !== "active") return false;
  if (target.schedule === null) return false;
  if (target.lastTriggeredAt === null) return true;

  const elapsedMs =
    new Date(now).getTime() - new Date(target.lastTriggeredAt).getTime();
  return elapsedMs >= target.schedule.intervalMs;
}

export async function runSchedulerTick(deps?: {
  projectId?: string;
  now?: string;
  trigger?: typeof triggerWatchTarget;
}): Promise<{
  triggered: { projectId: string; watchTargetId: string; runId: string }[];
  skipped: {
    projectId: string;
    watchTargetId: string;
    reason: SchedulerSkipReason;
  }[];
}> {
  const now = deps?.now ?? new Date().toISOString();
  const trigger = deps?.trigger ?? triggerWatchTarget;
  const triggered: { projectId: string; watchTargetId: string; runId: string }[] = [];
  const skipped: {
    projectId: string;
    watchTargetId: string;
    reason: SchedulerSkipReason;
  }[] = [];

  try {
    const projectIds = deps?.projectId
      ? [deps.projectId]
      : (await listProjectRecords()).map((record) => record.project.id);

    for (const projectId of projectIds) {
      const targets = await listWatchTargetRecords(projectId);

      for (const target of targets) {
        if (target.status !== "active") {
          skipped.push({
            projectId,
            watchTargetId: target.id,
            reason: "paused"
          });
          continue;
        }

        if (target.schedule === null) {
          skipped.push({
            projectId,
            watchTargetId: target.id,
            reason: "no_schedule"
          });
          continue;
        }

        if (!isWatchTargetDue(target, now)) {
          skipped.push({
            projectId,
            watchTargetId: target.id,
            reason: "not_due"
          });
          continue;
        }

        try {
          const result = await trigger(projectId, target.id, { now });
          triggered.push({
            projectId,
            watchTargetId: target.id,
            runId: result.run.id
          });
        } catch {
          skipped.push({
            projectId,
            watchTargetId: target.id,
            reason: "error"
          });
        }
      }
    }
  } catch {
    return { triggered, skipped };
  }

  return { triggered, skipped };
}
