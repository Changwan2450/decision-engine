import { deriveTitleFromUrl } from "@/lib/adapters/contract";
import type { SourceArtifact } from "@/lib/adapters/types";
import {
  assignTopicKey,
  extractTopicAnchors,
  inferClaimStance
} from "@/lib/orchestrator/claim-inference";
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

function tokenizeForAlias(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => token.length >= 2 && !/^\d+$/u.test(token)) ?? [];
}

function buildTopicAliasMap(artifacts: SourceArtifact[]): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const artifact of artifacts) {
    const tokens = tokenizeForAlias(artifact.title ?? "");
    for (let start = 0; start < tokens.length; start += 1) {
      for (let size = 2; size <= 3 && start + size <= tokens.length; size += 1) {
        const phraseTokens = tokens.slice(start, start + size);
        const alias = phraseTokens.map((token) => token[0] ?? "").join("");
        if (alias.length < 2) continue;
        const phrase = slugify(phraseTokens.join(" "));
        const current = aliases.get(alias);
        if (!current || phrase.length > current.length) {
          aliases.set(alias, phrase);
        }
      }
    }
  }

  return aliases;
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
    return lines.map((text) => ({ text, stance: inferClaimStance(text) }));
  }

  return raw ? [{ text: raw, stance: inferClaimStance(raw) }] : [];
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
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
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

  const seededClaims = artifacts.flatMap((artifact) => {
    const citation = citationByArtifactId.get(artifact.id);

    return parseClaimSeeds(artifact).map((seed, index) => ({
      artifactId: artifact.id,
      text: seed.text,
      topicKey: seed.topicKey,
      stance: seed.stance,
      citationIds: citation ? [citation.id] : [`missing-citation-${index}`]
    }));
  });
  const composedClaimTexts = seededClaims.map((seed) => {
    const artifact = artifactById.get(seed.artifactId);
    if (!artifact) return seed.text;

    const titleIsUrlDerived = artifact.title === deriveTitleFromUrl(artifact.url);
    if (titleIsUrlDerived) return seed.text;

    return `${seed.text} ${artifact.title ?? ""}`.trim();
  });
  const topicAliases = buildTopicAliasMap(artifacts);
  const inferredAnchors = extractTopicAnchors(seededClaims.map((seed) => seed.text));
  const anchorSet = new Set(
    inferredAnchors.map((anchor) => {
      const slug = slugify(anchor);
      return topicAliases.get(slug) ?? slug;
    })
  );
  const claims: Claim[] = seededClaims.map((seed) => ({
    id: `claim-${claimIndex++}`,
    artifactId: seed.artifactId,
    text: seed.text,
    topicKey: seed.topicKey,
    stance: seed.stance ?? "neutral",
    citationIds: seed.citationIds
  }));

  for (const [index, claim] of claims.entries()) {
    const matchedTopicKey = assignTopicKey(composedClaimTexts[index], inferredAnchors);
    if (matchedTopicKey) {
      claim.topicKey = topicAliases.get(matchedTopicKey) ?? matchedTopicKey;
    }
  }

  const contradictions: Contradiction[] = [];

  for (let i = 0; i < claims.length; i += 1) {
    const left = claims[i];
    if (!left.topicKey || !anchorSet.has(left.topicKey)) {
      continue;
    }

    for (let j = i + 1; j < claims.length; j += 1) {
      const right = claims[j];

      if (!right.topicKey || !anchorSet.has(right.topicKey) || left.topicKey !== right.topicKey) {
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
