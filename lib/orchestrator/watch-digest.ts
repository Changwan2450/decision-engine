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
    signal: {
      focusTopic: null,
      contradictionCount: 0,
      novelUrlCount: 0,
      sourceRunCount: deps.sourceRunIds.length,
      nextAction: null,
      delta: {
        previousFocusTopic: null,
        focusShifted: false,
        contradictionDelta: 0,
        novelUrlDelta: 0,
        sourceRunDelta: 0
      }
    },
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
  const previousSignal = pickPreviousDigestSignal(previousDigests);
  const digestSignal = buildDigestSignal({
    runs,
    previousSignal,
    novelUrlCount: novelUrls.length,
    sourceRunCount: deps.sourceRunIds.length
  });

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
    signal: {
      focusTopic: digestSignal.focusTopic,
      contradictionCount: digestSignal.contradictionCount,
      novelUrlCount: novelUrls.length,
      sourceRunCount: deps.sourceRunIds.length,
      nextAction: digestSignal.nextAction,
      delta: digestSignal.delta
    },
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
        signal: input.digest.signal,
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
        signal: input.digest.signal,
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
  signal: InboxItemRecord["signal"];
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
    signal: input.signal,
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

function buildDigestSignal(input: {
  runs: RunRecord[];
  previousSignal: DigestRecord["signal"] | null;
  novelUrlCount: number;
  sourceRunCount: number;
}): {
  focusTopic: string | null;
  contradictionCount: number;
  nextAction: string | null;
  recommendedAction: DigestRecord["recommendedAction"];
  delta: DigestRecord["signal"]["delta"];
} {
  const contradictionCount = input.runs.reduce(
    (sum, run) => sum + run.contradictions.length,
    0
  );
  const focusTopic =
    pickTopTopicKey(collectContradictionClaims(input.runs)) ??
    pickTopTopicKey(input.runs.flatMap((run) => run.claims));
  const formattedFocusTopic = focusTopic ? formatTopicKey(focusTopic) : null;
  const previousFocusTopic = input.previousSignal?.focusTopic ?? null;
  const contradictionDelta =
    contradictionCount - (input.previousSignal?.contradictionCount ?? 0);
  const focusShifted =
    formattedFocusTopic !== previousFocusTopic &&
    (formattedFocusTopic !== null || previousFocusTopic !== null);
  const novelUrlDelta = input.novelUrlCount - (input.previousSignal?.novelUrlCount ?? 0);
  const sourceRunDelta =
    input.sourceRunCount - (input.previousSignal?.sourceRunCount ?? 0);

  return {
    focusTopic: formattedFocusTopic,
    contradictionCount,
    nextAction: buildNextAction({
      focusTopic: formattedFocusTopic,
      contradictionCount,
      contradictionDelta,
      focusShifted
    }),
    recommendedAction: buildRecommendedAction({
      focusTopic: formattedFocusTopic,
      contradictionCount,
      contradictionDelta,
      focusShifted
    }),
    delta: {
      previousFocusTopic,
      focusShifted,
      contradictionDelta,
      novelUrlDelta,
      sourceRunDelta
    }
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
  signal: ReturnType<typeof buildDigestSignal>;
}): string {
  if (
    input.signal.focusTopic &&
    input.signal.recommendedAction?.type === "investigate_contradiction" &&
    input.signal.nextAction?.startsWith("reinvestigate")
  ) {
    return `${input.signal.focusTopic}: contradiction pressure +${input.signal.delta.contradictionDelta}, ${input.novelCount} novel urls`;
  }

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
  signal: ReturnType<typeof buildDigestSignal>;
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

  if (input.signal.delta.contradictionDelta > 0) {
    parts.push(`delta: contradictions +${input.signal.delta.contradictionDelta}`);
  } else if (input.signal.delta.contradictionDelta < 0) {
    parts.push(`delta: contradictions ${input.signal.delta.contradictionDelta}`);
  }

  if (input.signal.delta.focusShifted) {
    const previousFocus = input.signal.delta.previousFocusTopic ?? "none";
    const currentFocus = input.signal.focusTopic ?? "none";
    parts.push(`focus-shift: ${previousFocus} -> ${currentFocus}`);
  }

  return parts.join("; ");
}

function buildNextAction(input: {
  focusTopic: string | null;
  contradictionCount: number;
  contradictionDelta: number;
  focusShifted: boolean;
}): string | null {
  if (input.focusTopic && input.contradictionCount > 0) {
    if (input.contradictionDelta > 0 || input.focusShifted) {
      return `reinvestigate shifting evidence on ${input.focusTopic}`;
    }
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
  contradictionDelta: number;
  focusShifted: boolean;
}): DigestRecord["recommendedAction"] {
  if (input.focusTopic && input.contradictionCount > 0) {
    return {
      type: "investigate_contradiction",
      title:
        input.contradictionDelta > 0 || input.focusShifted
          ? `Reinvestigate shifting evidence on ${input.focusTopic}`
          : `Investigate conflicting evidence on ${input.focusTopic}`,
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

function pickPreviousDigestSignal(
  digests: DigestRecord[]
): DigestRecord["signal"] | null {
  const latest = [...digests].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
  )[0];
  return latest?.signal ?? null;
}
