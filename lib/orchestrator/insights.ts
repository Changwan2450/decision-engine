import type { SourceArtifact } from "@/lib/adapters/types";
import {
  evidenceSummarySchema,
  type Claim,
  type Citation,
  type Contradiction,
  type EvidenceSummary,
  type SourceArtifactRecord
} from "@/lib/domain/claims";
import { promotionCandidateSchema, type RunRecord } from "@/lib/storage/schema";

const sourcePriorityWeight = {
  official: 4,
  primary_data: 3,
  analysis: 2,
  community: 1
} as const;

type ClaimSeed = {
  text: string;
  topicKey?: string;
  stance?: "support" | "oppose" | "neutral";
};

export type EvidenceSynthesis = {
  artifacts: SourceArtifactRecord[];
  citations: Citation[];
  claims: Claim[];
  contradictions: Contradiction[];
  summary: EvidenceSummary;
};

export type ProjectInsightPatch = {
  repeatedProblems: string[];
  repeatedPatterns: string[];
  competitorSignals: string[];
  contradictionIds: string[];
};

type PromotionKind = "repeated_problem" | "repeated_pattern" | "competitor_signal";

function slugify(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .toLowerCase();
}

function parseClaimSeeds(artifact: SourceArtifact): ClaimSeed[] {
  const serialized = artifact.metadata.claims_json;

  if (serialized) {
    const parsed = JSON.parse(serialized) as ClaimSeed[];
    return parsed;
  }

  const raw = artifact.content || artifact.snippet;
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim());

  if (lines.length > 0) {
    return lines.map((text) => ({ text, stance: "neutral" }));
  }

  return raw ? [{ text: raw, stance: "neutral" }] : [];
}

function comparePriority(left: Citation, right: Citation): number {
  return sourcePriorityWeight[right.priority] - sourcePriorityWeight[left.priority];
}

function daysBetween(now: string, then: string): number {
  const nowTime = new Date(now).getTime();
  const thenTime = new Date(then).getTime();
  return Math.floor((nowTime - thenTime) / (1000 * 60 * 60 * 24));
}

export function synthesizeEvidenceFromArtifacts(
  artifacts: SourceArtifact[],
  options: {
    now: string;
    recencySensitive: boolean;
  }
): EvidenceSynthesis {
  let claimIndex = 0;
  const citations: Citation[] = artifacts
    .map((artifact, index) => ({
      id: `citation-${index}`,
      artifactId: artifact.id,
      url: artifact.url,
      title: artifact.title,
      priority: artifact.sourcePriority,
      publishedAt: artifact.publishedAt
    }))
    .sort(comparePriority);

  const citationByArtifactId = new Map(citations.map((citation) => [citation.artifactId, citation]));

  const claims: Claim[] = artifacts.flatMap((artifact) => {
    const citation = citationByArtifactId.get(artifact.id);

    return parseClaimSeeds(artifact).map((seed, index) => ({
      id: `claim-${claimIndex++}`,
      artifactId: artifact.id,
      text: seed.text,
      topicKey: seed.topicKey,
      stance: seed.stance ?? "neutral",
      citationIds: citation ? [citation.id] : [`missing-citation-${index}`]
    }));
  });

  const contradictions: Contradiction[] = [];

  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const left = claims[i];
      const right = claims[j];

      if (!left.topicKey || left.topicKey !== right.topicKey) {
        continue;
      }

      const isOpposed =
        (left.stance === "support" && right.stance === "oppose") ||
        (left.stance === "oppose" && right.stance === "support");

      if (isOpposed) {
        contradictions.push({
          id: `contradiction-${contradictions.length}`,
          claimIds: [left.id, right.id],
          status: "flagged",
          resolution: "unresolved"
        });
      }
    }
  }

  const reasons: EvidenceSummary["reasons"] = [];
  const highestPrioritySeen = citations[0]?.priority ?? null;

  if (contradictions.length > 0) {
    reasons.push("contradiction_detected");
  }

  if (
    options.recencySensitive &&
    citations.every((citation) =>
      citation.publishedAt ? daysBetween(options.now, citation.publishedAt) > 14 : true
    )
  ) {
    reasons.push("recency_gap");
  }

  if (!highestPrioritySeen || sourcePriorityWeight[highestPrioritySeen] < sourcePriorityWeight.primary_data) {
    reasons.push("insufficient_high_priority_support");
  }

  const summary = evidenceSummarySchema.parse({
    shouldRemainUnclear: reasons.length > 0,
    reasons,
    highestPrioritySeen,
    claimCount: claims.length,
    contradictionCount: contradictions.length
  });

  return {
    artifacts,
    citations,
    claims,
    contradictions,
    summary
  };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function deriveProjectInsightPatch(
  synthesis: EvidenceSynthesis
): ProjectInsightPatch {
  return {
    repeatedProblems: dedupe(
      synthesis.artifacts.map((artifact) => artifact.metadata.repeated_problem ?? "")
    ),
    repeatedPatterns: dedupe(
      synthesis.artifacts.map((artifact) => artifact.metadata.repeated_pattern ?? "")
    ),
    competitorSignals: dedupe(
      synthesis.artifacts.map((artifact) => artifact.metadata.competitor_signal ?? "")
    ),
    contradictionIds: synthesis.contradictions.map((contradiction) => contradiction.id)
  };
}

function isEligibleRun(record: RunRecord): boolean {
  return (
    record.run.status === "decided" &&
    !!record.evidenceSummary &&
    !record.evidenceSummary.shouldRemainUnclear &&
    record.evidenceSummary.contradictionCount === 0 &&
    (record.evidenceSummary.highestPrioritySeen === "official" ||
      record.evidenceSummary.highestPrioritySeen === "primary_data")
  );
}

function collectPromotionEntries(
  runRecords: RunRecord[],
  kind: PromotionKind,
  extract: (record: RunRecord) => string[]
) {
  const map = new Map<string, string[]>();

  for (const record of runRecords) {
    if (!isEligibleRun(record)) {
      continue;
    }

    const values = Array.from(new Set(extract(record).filter(Boolean)));
    for (const value of values) {
      map.set(value, [...(map.get(value) ?? []), record.run.id]);
    }
  }

  return Array.from(map.entries())
    .filter(([, runIds]) => runIds.length >= 2)
    .map(([title, sourceRunIds]) =>
      promotionCandidateSchema.parse({
        id: `${kind}-${slugify(title)}`,
        kind,
        title,
        summary: `${sourceRunIds.length}개 런에서 반복됐고 충돌 없이 고우선 출처 근거가 있다.`,
        sourceRunIds,
        status: "suggested",
        reason: "multiple_runs_high_priority_without_conflict"
      })
    );
}

export function derivePromotionCandidates(runRecords: RunRecord[]) {
  return [
    ...collectPromotionEntries(runRecords, "repeated_problem", (record) =>
      record.artifacts.map((artifact) => artifact.metadata.repeated_problem ?? "")
    ),
    ...collectPromotionEntries(runRecords, "repeated_pattern", (record) =>
      record.artifacts.map((artifact) => artifact.metadata.repeated_pattern ?? "")
    ),
    ...collectPromotionEntries(runRecords, "competitor_signal", (record) =>
      record.artifacts.map((artifact) => artifact.metadata.competitor_signal ?? "")
    )
  ];
}
