import { randomUUID } from "node:crypto";
import type { SourceArtifact } from "@/lib/adapters/types";
import type { DigestRecord, RunRecord } from "@/lib/storage/schema";
import {
  listDigestRecords,
  readRunRecord,
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

  const built: DigestRecord = {
    ...pending,
    headline: `${deps.sourceRunIds.length} runs, ${novelUrls.length} novel urls`,
    summary: `${novelUrls.length} novel urls across ${deps.sourceRunIds.length} source runs`,
    status: "built",
    updatedAt: now
  };

  deps.onStatusChange?.("built");
  await saveDigestRecord(built);
  return built;
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
