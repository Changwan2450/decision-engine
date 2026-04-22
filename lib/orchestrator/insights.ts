import { deriveTitleFromUrl } from "@/lib/adapters/contract";
import { inferSourceTier } from "@/lib/adapters/source-tier";
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
  type SourceArtifactRecord,
  type TrustTier
} from "@/lib/domain/claims";
import { promotionCandidateSchema, type RunRecord } from "@/lib/storage/schema";
import {
  CONTEXT_BOUNDARY_SPEC,
  RESEARCH_QUALITY_CONTRACT_VERSION,
  type ResearchRunType
} from "@/lib/orchestrator/research-quality-contract";

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

export type ProjectMemoryPatch = {
  decisionLedger: Array<{
    runId: string;
    title: string;
    decision: "go" | "no_go" | "unclear";
    confidence: "low" | "medium" | "high";
    why: string;
    createdAt: string;
    comparisonAxis: string | null;
    runType: ResearchRunType | null;
    contextClass: string | null;
    contractVersion: string;
    retainedAt: string | null;
    expiresAt: string | null;
  }>;
  topicLedger: Array<{
    topicKey: string;
    count: number;
    highTrustCount: number;
    lastSeenAt: string;
    contractVersion: string;
    retainedAt: string | null;
    expiresAt: string | null;
  }>;
  contradictionLedger: Array<{
    topicKey: string;
    count: number;
    lastSeenAt: string;
    contractVersion: string;
    retainedAt: string | null;
    expiresAt: string | null;
  }>;
};

type PromotionKind = "repeated_problem" | "repeated_pattern" | "competitor_signal";

function inferTrustTier(params: {
  sourcePriority: SourceArtifact["sourcePriority"];
  sourceTier?: SourceArtifact["sourceTier"];
}): TrustTier {
  if (params.sourcePriority === "official" || params.sourcePriority === "primary_data") {
    if (params.sourceTier === "aggregator") {
      return "medium";
    }
    return "high";
  }

  if (params.sourcePriority === "analysis") {
    if (params.sourceTier === "internal") {
      return "high";
    }
    if (params.sourceTier === "aggregator" || params.sourceTier === "unknown") {
      return "low";
    }
    return "medium";
  }

  if (params.sourceTier === "internal") {
    return "medium";
  }

  return "low";
}

function resolveArtifactTier(artifact: SourceArtifact): SourceArtifact["sourceTier"] {
  return artifact.sourceTier ?? inferSourceTier(artifact.canonicalUrl ?? artifact.url);
}

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

function isLowSignalFallbackClaimText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return true;
  }

  return /"kind"\s*:\s*"Listing"|AuthenticationRequiredError|"children"\s*:/u.test(trimmed);
}

function shouldSuppressFallbackClaims(artifact: SourceArtifact): boolean {
  const fetchStatus = artifact.metadata.fetch_status;
  return (
    fetchStatus === "blocked" ||
    fetchStatus === "error" ||
    fetchStatus === "timeout"
  );
}

function normalizeFallbackClaimText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

function isLowSignalFallbackClaimLine(text: string): boolean {
  const normalized = normalizeFallbackClaimText(text);

  if (!normalized) {
    return true;
  }

  return (
    /^[-/|]+$/u.test(normalized) ||
    /^(home|about|download|documentation|community|developers|support|donate|your account)$/iu.test(
      normalized
    ) ||
    /^(prev|up|next)$/iu.test(normalized) ||
    /^(supported versions|development versions|unsupported versions|sql commands)$/iu.test(
      normalized
    ) ||
    /^chapter\s+\d+/iu.test(normalized)
  );
}

function extractFallbackParagraphClaims(raw: string): ClaimSeed[] {
  const paragraphs = raw
    .split(/\n\s*\n/gu)
    .map((paragraph) => normalizeFallbackClaimText(paragraph))
    .filter((paragraph) => paragraph.length >= 120)
    .filter((paragraph) => !paragraph.startsWith("## "))
    .filter((paragraph) => !isLowSignalFallbackClaimText(paragraph))
    .filter((paragraph) => !isLowSignalFallbackClaimLine(paragraph))
    .map((paragraph) => {
      const sentences = paragraph.match(/[^.!?]+[.!?]+/gu) ?? [paragraph];
      return sentences.slice(0, 2).join(" ").trim();
    })
    .filter((paragraph) => paragraph.length >= 80)
    .slice(0, 3);

  return paragraphs.map((text) => ({ text, stance: inferClaimStance(text) }));
}

function parseClaimSeeds(artifact: SourceArtifact): ClaimSeed[] {
  const serialized = artifact.metadata.claims_json;

  if (serialized) {
    const parsed = JSON.parse(serialized) as ClaimSeed[];
    return parsed;
  }

  if (shouldSuppressFallbackClaims(artifact)) {
    return [];
  }

  const raw = artifact.content || artifact.snippet;
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim())
    .map((line) => normalizeFallbackClaimText(line))
    .filter((line) => !isLowSignalFallbackClaimLine(line));

  if (lines.length > 0) {
    return lines.map((text) => ({ text, stance: inferClaimStance(text) }));
  }

  const paragraphClaims = extractFallbackParagraphClaims(raw);
  if (paragraphClaims.length > 0) {
    return paragraphClaims;
  }

  if (!raw || isLowSignalFallbackClaimText(raw)) {
    return [];
  }

  const normalized = normalizeFallbackClaimText(raw);
  if (!normalized || isLowSignalFallbackClaimLine(normalized)) {
    return [];
  }

  return [{ text: normalized, stance: inferClaimStance(normalized) }];
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
    .map((artifact, index) => {
      const sourceTier = resolveArtifactTier(artifact);
      return {
        id: `citation-${index}`,
        artifactId: artifact.id,
        url: artifact.url,
        title: artifact.title,
        priority: artifact.sourcePriority,
        sourceTier,
        trustTier: inferTrustTier({
          sourcePriority: artifact.sourcePriority,
          sourceTier
        }),
        retrievedAt: artifact.retrievedAt,
        publishedAt: artifact.publishedAt
      };
    })
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
  const claims: Claim[] = seededClaims.map((seed) => {
    const artifact = artifactById.get(seed.artifactId);
    const sourceTier = artifact ? resolveArtifactTier(artifact) : undefined;
    const citationCount = seed.citationIds.length;
    const trustTier = inferTrustTier({
      sourcePriority: artifact?.sourcePriority ?? "community",
      sourceTier
    });

    return {
      id: `claim-${claimIndex++}`,
      artifactId: seed.artifactId,
      text: seed.text,
      topicKey: seed.topicKey,
      stance: seed.stance ?? "neutral",
      citationIds: seed.citationIds,
      sourceTier,
      trustTier,
      observedAt: artifact?.publishedAt ?? artifact?.retrievedAt,
      provenance: artifact
        ? {
            sourcePriority: artifact.sourcePriority,
            sourceTier,
            trustTier,
            citationCount,
            observedAt: artifact.publishedAt ?? artifact.retrievedAt,
            artifactTitle: artifact.title,
            artifactUrl: artifact.url
          }
        : undefined
    };
  });

  for (const [index, claim] of claims.entries()) {
    if (claim.topicKey === "project-prior-decision") {
      continue;
    }

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

export function deriveProjectMemoryPatch(params: {
  record: Pick<RunRecord, "run" | "watchContext" | "normalizedInput">;
  synthesis: EvidenceSynthesis;
  decision: {
    value: "go" | "no_go" | "unclear";
    confidence: "low" | "medium" | "high";
    why: string;
  };
  now: string;
}): ProjectMemoryPatch {
  const runType = inferMemoryRunType(params.record);
  const contextClass = CONTEXT_BOUNDARY_SPEC.classes[runType];
  const decisionExpiry = addDays(params.now, 30);
  const signalExpiry = addDays(params.now, 21);
  const topicCounts = new Map<
    string,
    {
      count: number;
      highTrustCount: number;
      lastSeenAt: string;
    }
  >();
  for (const claim of params.synthesis.claims) {
    if (!claim.topicKey) continue;
    const current = topicCounts.get(claim.topicKey) ?? {
      count: 0,
      highTrustCount: 0,
      lastSeenAt: params.now
    };
    current.count += 1;
    if (claim.trustTier === "high") {
      current.highTrustCount += 1;
    }
    current.lastSeenAt = params.now;
    topicCounts.set(claim.topicKey, current);
  }

  const claimById = new Map(params.synthesis.claims.map((claim) => [claim.id, claim]));
  const contradictionCounts = new Map<string, { count: number; lastSeenAt: string }>();
  for (const contradiction of params.synthesis.contradictions) {
    const topics = contradiction.claimIds
      .map((claimId) => claimById.get(claimId)?.topicKey)
      .filter((topicKey): topicKey is string => Boolean(topicKey));
    for (const topicKey of new Set(topics)) {
      const current = contradictionCounts.get(topicKey) ?? {
        count: 0,
        lastSeenAt: params.now
      };
      current.count += 1;
      current.lastSeenAt = params.now;
      contradictionCounts.set(topicKey, current);
    }
  }

  return {
    decisionLedger: [
      {
        runId: params.record.run.id,
        title: params.record.run.title,
        decision: params.decision.value,
        confidence: params.decision.confidence,
        why: params.decision.why,
        createdAt: params.record.run.createdAt,
        comparisonAxis: params.record.normalizedInput?.comparisonAxis?.trim() || null,
        runType,
        contextClass,
        contractVersion: RESEARCH_QUALITY_CONTRACT_VERSION,
        retainedAt: params.now,
        expiresAt: decisionExpiry
      }
    ],
    topicLedger: Array.from(topicCounts.entries()).map(([topicKey, value]) => ({
      topicKey,
      count: value.count,
      highTrustCount: value.highTrustCount,
      lastSeenAt: value.lastSeenAt,
      contractVersion: RESEARCH_QUALITY_CONTRACT_VERSION,
      retainedAt: params.now,
      expiresAt: signalExpiry
    })),
    contradictionLedger: Array.from(contradictionCounts.entries()).map(([topicKey, value]) => ({
      topicKey,
      count: value.count,
      lastSeenAt: value.lastSeenAt,
      contractVersion: RESEARCH_QUALITY_CONTRACT_VERSION,
      retainedAt: params.now,
      expiresAt: signalExpiry
    }))
  };
}

function inferMemoryRunType(
  record: Pick<RunRecord, "watchContext" | "normalizedInput">
): ResearchRunType {
  if (record.watchContext?.watchTargetId) {
    return "longitudinal_watch";
  }

  const title = record.normalizedInput?.title ?? "";
  const naturalLanguage = record.normalizedInput?.naturalLanguage ?? "";
  const goal = record.normalizedInput?.goal ?? "";
  const comparisonAxis = record.normalizedInput?.comparisonAxis ?? "";
  const haystack = [title, naturalLanguage, goal, comparisonAxis]
    .join(" ")
    .toLowerCase();

  if (comparisonAxis || /\bvs\b|versus|대/.test(haystack)) {
    return "comparison_tradeoff_analysis";
  }
  if (/상충|contradiction|반증|re-?check/.test(haystack)) {
    return "contradiction_resolution";
  }
  if (/결정|판단|verify|verification|검증/.test(haystack)) {
    return "pre_decision_verification";
  }
  return "exploratory_scan";
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
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
