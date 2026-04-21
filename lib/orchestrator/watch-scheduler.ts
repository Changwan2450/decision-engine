import { triggerWatchTarget } from "@/lib/orchestrator/watch-runtime";
import type { InboxItemRecord, WatchTargetRecord } from "@/lib/storage/schema";
import {
  listInboxItemRecords,
  listProjectRecords,
  listWatchTargetRecords
} from "@/lib/storage/workspace";

type SchedulerSkipReason = "paused" | "no_schedule" | "not_due" | "error";
type SchedulerActionableItem = {
  projectId: string;
  watchTargetId: string;
  inboxItemId: string;
  refId: string;
  kind: InboxItemRecord["kind"];
  priority: "high" | "medium";
  actionType: NonNullable<InboxItemRecord["recommendedAction"]>["type"];
  actionTitle: string;
  contradictionDelta: number;
  focusShifted: boolean;
};

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
  actionable?: SchedulerActionableItem[];
}> {
  const now = deps?.now ?? new Date().toISOString();
  const trigger = deps?.trigger ?? triggerWatchTarget;
  const triggered: { projectId: string; watchTargetId: string; runId: string }[] = [];
  const skipped: {
    projectId: string;
    watchTargetId: string;
    reason: SchedulerSkipReason;
  }[] = [];
  const actionable: SchedulerActionableItem[] = [];

  try {
    const projectIds = deps?.projectId
      ? [deps.projectId]
      : (await listProjectRecords()).map((record) => record.project.id);

    for (const projectId of projectIds) {
      const targets = await listWatchTargetRecords(projectId);
      const inboxItems = await listInboxItemRecords(projectId);

      actionable.push(...collectActionableInboxItems(projectId, inboxItems));

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
    return { triggered, skipped, actionable };
  }

  return { triggered, skipped, actionable };
}

function collectActionableInboxItems(
  projectId: string,
  items: InboxItemRecord[]
): SchedulerActionableItem[] {
  return items
    .filter(
      (item): item is InboxItemRecord & {
        recommendedAction: NonNullable<InboxItemRecord["recommendedAction"]>;
        watchTargetId: string;
      } =>
        item.status === "unread" &&
        Boolean(item.watchTargetId) &&
        Boolean(item.recommendedAction)
    )
    .map((item) => ({
      projectId,
      watchTargetId: item.watchTargetId,
      inboxItemId: item.id,
      refId: item.refId,
      kind: item.kind,
      priority:
        item.recommendedAction.type === "investigate_contradiction"
          ? ("high" as const)
          : ("medium" as const),
      actionType: item.recommendedAction.type,
      actionTitle: item.recommendedAction.title,
      contradictionDelta: item.signal.delta.contradictionDelta,
      focusShifted: item.signal.delta.focusShifted
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority === "high" ? -1 : 1;
      }

      if (a.contradictionDelta !== b.contradictionDelta) {
        return b.contradictionDelta - a.contradictionDelta;
      }

      if (a.focusShifted !== b.focusShifted) {
        return a.focusShifted ? -1 : 1;
      }

      return a.actionTitle.localeCompare(b.actionTitle);
    });
}
