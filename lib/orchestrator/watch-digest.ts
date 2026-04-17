import { randomUUID } from "node:crypto";
import type { SourceArtifact } from "@/lib/adapters/types";
import type { DigestRecord, InboxItemRecord, RunRecord } from "@/lib/storage/schema";
import {
  listDigestRecords,
  readWatchTargetRecord,
  readRunRecord,
  saveInboxItemRecord,
  saveDigestRecord
} from "@/lib/storage/workspace";

export async function buildWatchDigest(
  projectId: string,
  watchTargetId: string,
  deps: {
    sourceRunIds: string[];
    now?: string;
    onStatusChange?: (status: DigestRecord["status"]) => void;
  }
): Promise<DigestRecord> {
  const now = deps.now ?? new Date().toISOString();
  const pending: DigestRecord = {
    id: randomUUID(),
    projectId,
    watchTargetId,
    windowStart: now,
    windowEnd: now,
    sourceRunIds: deps.sourceRunIds,
    headline: "pending digest",
    summary: "",
    status: "pending",
    createdAt: now,
    updatedAt: now
  };

  deps.onStatusChange?.("pending");
  await saveDigestRecord(pending);

  const runs = await Promise.all(
    deps.sourceRunIds.map((runId) => readRunRecord(projectId, runId))
  );
  const previousDigests = (await listDigestRecords(projectId)).filter(
    (digest) => digest.watchTargetId === watchTargetId && digest.id !== pending.id
  );
  const previousRunIds = new Set(previousDigests.flatMap((digest) => digest.sourceRunIds));
  const previousRuns = await Promise.all(
    Array.from(previousRunIds).map((runId) => readRunRecord(projectId, runId))
  );

  const previousUrls = collectArtifactUrls(previousRuns);
  const currentUrls = collectArtifactUrls(runs);
  const novelUrls = Array.from(currentUrls).filter((url) => !previousUrls.has(url));
  const watchTarget = await readWatchTargetRecord(projectId, watchTargetId);

  const built: DigestRecord = {
    ...pending,
    headline: `${deps.sourceRunIds.length} runs, ${novelUrls.length} novel urls`,
    summary: `${novelUrls.length} novel urls across ${deps.sourceRunIds.length} source runs`,
    status: "built",
    updatedAt: now
  };

  deps.onStatusChange?.("built");
  await saveDigestRecord(built);
  await createInboxItems({
    projectId,
    watchTargetId,
    digest: built,
    title: watchTarget.title,
    novelCount: novelUrls.length,
    delivery: watchTarget.delivery
  });
  return built;
}

async function createInboxItems(input: {
  projectId: string;
  watchTargetId: string;
  digest: DigestRecord;
  title: string;
  novelCount: number;
  delivery: {
    digest: boolean;
    alert: boolean;
    inbox: boolean;
  };
}): Promise<void> {
  if (input.delivery.inbox) {
    await saveInboxItemRecord(
      buildInboxItem({
        projectId: input.projectId,
        watchTargetId: input.watchTargetId,
        digestId: input.digest.id,
        kind: "digest",
        title: `${input.title} digest`,
        summary: input.digest.summary,
        now: input.digest.updatedAt
      })
    );
  }

  if (input.delivery.alert && input.novelCount > 0) {
    await saveInboxItemRecord(
      buildInboxItem({
        projectId: input.projectId,
        watchTargetId: input.watchTargetId,
        digestId: input.digest.id,
        kind: "alert",
        title: `${input.title} alert`,
        summary: `${input.novelCount} novel items detected`,
        now: input.digest.updatedAt
      })
    );
  }
}

function buildInboxItem(input: {
  projectId: string;
  watchTargetId: string;
  digestId: string;
  kind: InboxItemRecord["kind"];
  title: string;
  summary: string;
  now: string;
}): InboxItemRecord {
  return {
    id: randomUUID(),
    projectId: input.projectId,
    kind: input.kind,
    refId: input.digestId,
    watchTargetId: input.watchTargetId,
    status: "unread",
    title: input.title,
    summary: input.summary,
    createdAt: input.now,
    updatedAt: input.now
  };
}

function collectArtifactUrls(runs: RunRecord[]): Set<string> {
  const urls = new Set<string>();

  for (const run of runs) {
    for (const artifact of run.artifacts) {
      const fetchStatus = artifact.metadata.fetch_status;
      if (fetchStatus !== "success" && fetchStatus !== "partial") continue;
      const url = normalizeArtifactUrl(artifact);
      if (url) urls.add(url);
    }
  }

  return urls;
}

function normalizeArtifactUrl(artifact: SourceArtifact): string | null {
  const url = artifact.canonicalUrl ?? artifact.url;
  return url && url.length > 0 ? url : null;
}
