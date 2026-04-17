import { executeResearchRun } from "@/lib/orchestrator/run-research";
import type { RunRecord } from "@/lib/storage/schema";
import {
  createRunRecord,
  listInboxItemRecords,
  readDigestRecord,
  readWatchTargetRecord,
  updateInboxItemRecord
} from "@/lib/storage/workspace";

export async function promoteDigestToProject(
  projectId: string,
  digestId: string,
  deps?: {
    now?: string;
    executeRun?: (projectId: string, runId: string) => Promise<RunRecord>;
  }
): Promise<RunRecord> {
  const digest = await readDigestRecord(projectId, digestId);
  const watchTarget = await readWatchTargetRecord(projectId, digest.watchTargetId);
  const createdRun = await createRunRecord(projectId, {
    title: `Promoted: ${watchTarget.title}`,
    naturalLanguage: watchTarget.query.naturalLanguage,
    pastedContent: `Promoted from digest ${digest.id}: ${digest.summary}`,
    urls: watchTarget.query.urls
  });

  const inboxItems = await listInboxItemRecords(projectId);
  const digestInbox = inboxItems.find(
    (item) => item.kind === "digest" && item.refId === digest.id
  );
  if (digestInbox) {
    await updateInboxItemRecord(projectId, digestInbox.id, (record) => ({
      ...record,
      status: "promoted",
      updatedAt: deps?.now ?? new Date().toISOString()
    }));
  }

  const executeRun =
    deps?.executeRun ?? ((p, r) => executeResearchRun(p, r, { now: deps?.now }));
  return executeRun(projectId, createdRun.run.id);
}
