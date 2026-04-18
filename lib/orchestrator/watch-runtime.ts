import { executeResearchRun } from "@/lib/orchestrator/run-research";
import type { RunRecord } from "@/lib/storage/schema";
import {
  createRunRecord,
  readWatchTargetRecord,
  updateWatchTargetRecord,
  updateRunRecord
} from "@/lib/storage/workspace";

export async function triggerWatchTarget(
  projectId: string,
  watchTargetId: string,
  deps?: {
    now?: string;
    triggerId?: string;
    executeRun?: (projectId: string, runId: string) => Promise<RunRecord>;
  }
): Promise<RunRecord> {
  const watchTarget = await readWatchTargetRecord(projectId, watchTargetId);
  const createdRun = await createRunRecord(projectId, {
    title: watchTarget.title,
    naturalLanguage: watchTarget.query.naturalLanguage,
    urls: watchTarget.query.urls
  });

  await updateRunRecord(projectId, createdRun.run.id, (record) => ({
    ...record,
    watchContext: {
      watchTargetId,
      triggerId: deps?.triggerId,
      digestId: null
    }
  }));

  const executeRun = deps?.executeRun ?? ((p, r) => executeResearchRun(p, r, { now: deps?.now }));
  const result = await executeRun(projectId, createdRun.run.id);
  const triggeredAt = deps?.now ?? new Date().toISOString();
  await updateWatchTargetRecord(projectId, watchTargetId, (record) => ({
    ...record,
    lastTriggeredAt: triggeredAt,
    updatedAt: triggeredAt
  }));
  return result;
}
