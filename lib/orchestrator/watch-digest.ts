import { randomUUID } from "node:crypto";
import type { SourceArtifact } from "@/lib/adapters/types";
import type { Claim } from "@/lib/domain/claims";
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
    recommendedAction: null,
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
  const digestSignal = buildDigestSignal(runs);

  const built: DigestRecord = {
    ...pending,
    headline: buildDigestHeadline({
      runCount: deps.sourceRunIds.length,
      novelCount: novelUrls.length,
      signal: digestSignal
    }),
    summary: buildDigestSummary({
      runCount: deps.sourceRunIds.length,
      novelCount: novelUrls.length,
      signal: digestSignal
    }),
    recommendedAction: digestSignal.recommendedAction,
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
        recommendedAction: input.digest.recommendedAction,
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
        summary: input.digest.summary,
        recommendedAction: input.digest.recommendedAction,
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
  recommendedAction: InboxItemRecord["recommendedAction"];
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
    recommendedAction: input.recommendedAction,
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

function buildDigestSignal(runs: RunRecord[]): {
  focusTopic: string | null;
  contradictionCount: number;
  nextAction: string | null;
  recommendedAction: DigestRecord["recommendedAction"];
} {
  const contradictionCount = runs.reduce(
    (sum, run) => sum + run.contradictions.length,
    0
  );
  const focusTopic =
    pickTopTopicKey(collectContradictionClaims(runs)) ??
    pickTopTopicKey(runs.flatMap((run) => run.claims));

  return {
    focusTopic: focusTopic ? formatTopicKey(focusTopic) : null,
    contradictionCount,
    nextAction: buildNextAction({
      focusTopic: focusTopic ? formatTopicKey(focusTopic) : null,
      contradictionCount
    }),
    recommendedAction: buildRecommendedAction({
      focusTopic: focusTopic ? formatTopicKey(focusTopic) : null,
      contradictionCount
    })
  };
}

function collectContradictionClaims(runs: RunRecord[]): Claim[] {
  const claims: Claim[] = [];

  for (const run of runs) {
    const claimById = new Map(run.claims.map((claim) => [claim.id, claim]));
    for (const contradiction of run.contradictions) {
      for (const claimId of contradiction.claimIds) {
        const claim = claimById.get(claimId);
        if (claim) {
          claims.push(claim);
        }
      }
    }
  }

  return claims;
}

function pickTopTopicKey(claims: Claim[]): string | null {
  const counts = new Map<string, number>();

  for (const claim of claims) {
    if (!claim.topicKey) continue;
    counts.set(claim.topicKey, (counts.get(claim.topicKey) ?? 0) + 1);
  }

  let topTopic: string | null = null;
  let topCount = 0;
  for (const [topicKey, count] of counts.entries()) {
    if (count > topCount) {
      topTopic = topicKey;
      topCount = count;
    }
  }

  return topTopic;
}

function formatTopicKey(topicKey: string): string {
  return topicKey.replace(/[-_]+/g, " ").trim();
}

function buildDigestHeadline(input: {
  runCount: number;
  novelCount: number;
  signal: {
    focusTopic: string | null;
    contradictionCount: number;
    nextAction: string | null;
    recommendedAction: DigestRecord["recommendedAction"];
  };
}): string {
  if (input.signal.focusTopic && input.signal.contradictionCount > 0) {
    return `${input.signal.focusTopic}: ${input.signal.contradictionCount} contradictions, ${input.novelCount} novel urls`;
  }

  if (input.signal.focusTopic) {
    return `${input.signal.focusTopic}: ${input.novelCount} novel urls across ${input.runCount} runs`;
  }

  return `${input.runCount} runs, ${input.novelCount} novel urls`;
}

function buildDigestSummary(input: {
  runCount: number;
  novelCount: number;
  signal: {
    focusTopic: string | null;
    contradictionCount: number;
    nextAction: string | null;
  };
}): string {
  const parts = [
    `${input.novelCount} novel urls across ${input.runCount} source runs`
  ];

  if (input.signal.focusTopic) {
    parts.push(`focus: ${input.signal.focusTopic}`);
  }

  if (input.signal.contradictionCount > 0) {
    parts.push(`contradictions: ${input.signal.contradictionCount}`);
  }

  if (input.signal.nextAction) {
    parts.push(`next: ${input.signal.nextAction}`);
  }

  return parts.join("; ");
}

function buildNextAction(input: {
  focusTopic: string | null;
  contradictionCount: number;
}): string | null {
  if (input.focusTopic && input.contradictionCount > 0) {
    return `investigate conflicting evidence on ${input.focusTopic}`;
  }

  if (input.focusTopic) {
    return `review new evidence on ${input.focusTopic}`;
  }

  return null;
}

function buildRecommendedAction(input: {
  focusTopic: string | null;
  contradictionCount: number;
}): DigestRecord["recommendedAction"] {
  if (input.focusTopic && input.contradictionCount > 0) {
    return {
      type: "investigate_contradiction",
      title: `Investigate conflicting evidence on ${input.focusTopic}`,
      focusTopic: input.focusTopic,
      contradictionCount: input.contradictionCount
    };
  }

  if (input.focusTopic) {
    return {
      type: "review_focus_topic",
      title: `Review new evidence on ${input.focusTopic}`,
      focusTopic: input.focusTopic
    };
  }

  return {
    type: "review_digest",
    title: "Review digest for novel evidence"
  };
}
