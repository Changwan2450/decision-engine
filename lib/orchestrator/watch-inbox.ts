import { executeResearchRun } from "@/lib/orchestrator/run-research";
import type { RunRecord } from "@/lib/storage/schema";
import {
  createRunRecord,
  findInboxItemsByRefId,
  listInboxItemRecords,
  readDigestRecord,
  readWatchTargetRecord,
  updateInboxItemStatus,
  updateRunRecord
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
  const digestInboxItems = await findInboxItemsByRefId(projectId, digest.id);
  const digestInbox = digestInboxItems.find((item) => item.kind === "digest");
  const createdRun = await createRunRecord(projectId, {
    title: `Promoted: ${watchTarget.title}`,
    naturalLanguage: watchTarget.query.naturalLanguage,
    pastedContent: `Promoted from digest ${digest.id}: ${digest.summary}`,
    urls: watchTarget.query.urls
  });
  await updateRunRecord(projectId, createdRun.run.id, (record) => ({
    ...record,
    projectOrigin: {
      source: "watch_digest",
      watchTargetId: digest.watchTargetId,
      digestId: digest.id,
      inboxItemId: digestInbox?.id ?? "",
      sourceRunIds: digest.sourceRunIds
    }
  }));

  if (digestInbox) {
    await updateInboxItemStatus(projectId, digestInbox.id, "promoted", {
      promotedRunId: createdRun.run.id,
      now: deps?.now
    });
  }

  const executeRun =
    deps?.executeRun ?? ((p, r) => executeResearchRun(p, r, { now: deps?.now }));
  return executeRun(projectId, createdRun.run.id);
}
