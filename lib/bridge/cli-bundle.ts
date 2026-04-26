import type { DecisionHistoryItem } from "@/lib/orchestrator/decision-history";
import type { ProjectInsightPatch } from "@/lib/orchestrator/insights";
import type { Project } from "@/lib/domain/projects";
import type { RunRecord, ProjectRecord } from "@/lib/storage/schema";

export type CliBridgeProvider = "claude" | "codex";
export type CliBridgeMode = "prompt_only" | "cli_execute";

type RuntimeProvenance = NonNullable<RunRecord["runtimeProvenance"]>;
type RetrievalAttemptGaps = NonNullable<RunRecord["retrievalAttemptGaps"]> | null;
type RepairAttempts = {
  version: "v0";
  sourceCoverage: {
    attempted: boolean;
    reason?: string;
    discoverySource?: string;
    candidateCount?: number;
    allowedUrlCount?: number;
    primaryDiscovery: {
      attempted: boolean;
      blocked?: boolean;
      artifactIds: string[];
      sourceTiers: string[];
      urls: string[];
    };
    fallbackDiscovery: {
      attempted: boolean;
      candidateUrlCount?: number;
      allowedUrlCount?: number;
      rawSourcesChecked?: number;
      sourceArtifactIds: string[];
      note?: string;
    };
    followedEvidence: {
      count: number;
      artifactIds: string[];
      sourcePriorities: string[];
      sourceTiers: string[];
      urls: string[];
      artifacts: Array<{
        artifactId: string;
        url: string;
        sourcePriority?: string;
        sourceTier?: string;
        repairStage?: string;
        repairSourceHostClass?: string;
        repairFollowRank?: string;
      }>;
    };
    failedFollowAttempts: {
      count: number;
      artifacts: Array<{
        artifactId: string;
        url: string;
        fetchStatus?: string;
        sourcePriority?: string;
        sourceTier?: string;
        repairStage?: string;
        repairSourceHostClass?: string;
        repairFollowRank?: string;
      }>;
    };
    outcome:
      | "not_attempted"
      | "blocked_primary"
      | "no_candidates"
      | "followed_evidence"
      | "no_improvement";
  };
};

type EvidenceDiagnostics = {
  decisiveEvidenceScore?: number;
  falseConvergenceRisk?: boolean;
  convergenceRiskReasons?: string[];
  counterevidenceChecked?: boolean;
  supportOnlyEvidence?: boolean;
  weakEvidence?: boolean;
  sourcePriorityCounts?: {
    official: number;
    primary_data: number;
    analysis: number;
    community: number;
  };
  sourceTierCounts?: {
    official: number;
    primary: number;
    internal: number;
    community: number;
    aggregator: number;
    unknown: number;
  };
  sourcePriorityDiversity?: number;
  hasOfficialOrPrimaryEvidence?: boolean;
  aggregatorOnlyEvidence?: boolean;
  sourceCoverageWarnings?: string[];
} | null;

type EvidenceReplay = {
  version: "v0";
  limits: {
    topArtifacts: 8;
    topClaims: 8;
    topCitations: 8;
    contradictions: 5;
    retrievalFailures: 8;
  };
  topArtifacts: Array<{
    id: string;
    title: string;
    url: string;
    adapter?: string;
    sourceType?: string;
    sourcePriority?: string;
    sourceTier?: string;
    trustHint: "high" | "medium" | "low";
    fetchStatus?: string;
    retrievedAt?: string;
    publishedAt?: string;
    snippet: string;
  }>;
  topClaims: Array<{
    id: string;
    text: string;
    stance: string;
    topicKey?: string;
    artifactId?: string;
    artifactTitle?: string;
    sourcePriority?: string;
    sourceTier?: string;
    trustTier?: string;
    citationIds: string[];
  }>;
  topCitations: Array<{
    id: string;
    artifactId?: string;
    title?: string;
    url?: string;
    priority?: string;
    sourceTier?: string;
    trustTier?: string;
    retrievedAt?: string;
    publishedAt?: string;
  }>;
  contradictions: Array<{
    id: string;
    claimIds: string[];
    status?: string;
    resolution?: string;
    kind?: string;
    tierA?: string;
    tierB?: string;
  }>;
  retrievalFailures: Array<{
    artifactId: string;
    title?: string;
    url?: string;
    adapter?: string;
    sourcePriority?: string;
    sourceTier?: string;
    fetchStatus: "blocked" | "timeout" | "error";
    blockReason?: string;
    bypassLevel?: string;
    loginRequired?: string;
    sourceLabel?: string;
  }>;
  sourceQualitySummary: {
    artifactCount: number;
    claimCount: number;
    citationCount: number;
    contradictionCount: number;
    retrievalFailureCount: number;
    sourcePriorityCounts?: unknown;
    sourceTierCounts?: unknown;
    hasOfficialOrPrimaryEvidence?: boolean;
    weakEvidence?: boolean;
    falseConvergenceRisk?: boolean;
  };
  unresolvedEvidenceGaps: string[];
};

export type CliBridgeBundle = {
  project: {
    id: string;
    name: string;
    description: string;
  };
  latestRun: {
    id: string;
    decision: "go" | "no_go" | "unclear";
    confidence: "low" | "medium" | "high";
    why: string;
    blockingUnknowns: string[];
  };
  insights: {
    repeatedProblems: string[];
    solutionPatterns: string[];
    competitorSignals: string[];
    conflicts: string[];
  };
  evidenceDiagnostics: EvidenceDiagnostics;
  evidenceReplay: EvidenceReplay;
  retrievalAttemptGaps: RetrievalAttemptGaps;
  repairAttempts: RepairAttempts;
  runtimeProvenance: RuntimeProvenance | null;
  decisionHistory: DecisionHistoryItem[];
  kb: {
    promotionCandidates: ProjectRecord["promotionCandidates"];
    relatedRuns: Array<{
      runId: string;
      title: string;
      decision: "go" | "no_go" | "unclear";
      why: string;
      createdAt: string;
    }>;
    decisionHistorySummary: Array<{
      runId: string;
      title: string;
      decision: "go" | "no_go" | "unclear";
      createdAt: string;
    }>;
    recentContradictions: Array<{
      runId: string;
      contradictionId: string;
      status: "flagged" | "reviewed";
      resolution: "unresolved" | "accepted" | "dismissed";
    }>;
    projectInsightSummary: {
      repeatedProblems?: string;
      solutionPatterns?: string;
      competitorSignals?: string;
      conflicts?: string;
    };
  };
  bridge: {
    provider: CliBridgeProvider;
    mode: CliBridgeMode;
    generatedAt: string;
    projectId: string;
    runId: string;
    schemaVersion: "cli-bridge-v1";
  };
};

const EVIDENCE_REPLAY_LIMITS = {
  topArtifacts: 8,
  topClaims: 8,
  topCitations: 8,
  contradictions: 5,
  retrievalFailures: 8
} as const;

const RETRIEVAL_ATTEMPT_GAP_LIMITS = {
  emptyResults: 8,
  droppedAttempts: 8
} as const;

const sourcePriorityRank: Record<string, number> = {
  official: 0,
  primary_data: 1,
  analysis: 2,
  community: 3
};

const sourceTierRank: Record<string, number> = {
  official: 0,
  primary: 1,
  internal: 2,
  community: 3,
  aggregator: 4,
  unknown: 5
};

const trustTierRank: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2
};

const failedFetchStatuses = new Set(["blocked", "timeout", "error"]);

function truncateText(value: string | undefined, maxLength = 240): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function rankSourcePriority(priority: string | undefined): number {
  return sourcePriorityRank[priority ?? ""] ?? 99;
}

function rankSourceTier(tier: string | undefined): number {
  return sourceTierRank[tier ?? "unknown"] ?? sourceTierRank.unknown;
}

function rankTrustTier(tier: string | undefined): number {
  return trustTierRank[tier ?? "low"] ?? trustTierRank.low;
}

function inferTrustHint(params: {
  sourcePriority?: string;
  sourceTier?: string;
}): "high" | "medium" | "low" {
  if (
    params.sourcePriority === "official" ||
    params.sourcePriority === "primary_data" ||
    params.sourceTier === "official" ||
    params.sourceTier === "primary"
  ) {
    return "high";
  }
  if (params.sourcePriority === "analysis" || params.sourceTier === "internal") {
    return "medium";
  }
  return "low";
}

function compareByIndex<T>(
  left: { item: T; index: number },
  right: { item: T; index: number },
  compare: (left: T, right: T) => number
): number {
  const result = compare(left.item, right.item);
  return result === 0 ? left.index - right.index : result;
}

function buildUnresolvedEvidenceGaps(diagnostics: EvidenceDiagnostics): string[] {
  if (!diagnostics) return [];

  const gaps: string[] = [];
  const add = (value: string | undefined) => {
    if (value && !gaps.includes(value)) {
      gaps.push(value);
    }
  };

  for (const warning of diagnostics.sourceCoverageWarnings ?? []) add(warning);
  for (const reason of diagnostics.convergenceRiskReasons ?? []) add(reason);
  if (diagnostics.counterevidenceChecked === false) add("counterevidence_not_checked");
  if (diagnostics.weakEvidence === true) add("weak_evidence");
  if (diagnostics.hasOfficialOrPrimaryEvidence === false) add("no_official_or_primary_evidence");

  return gaps;
}

function buildEvidenceReplay(
  run: RunRecord,
  diagnostics: EvidenceDiagnostics
): EvidenceReplay {
  const artifacts = run.artifacts ?? [];
  const claims = run.claims ?? [];
  const citations = run.citations ?? [];
  const contradictions = run.contradictions ?? [];
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));

  const retrievalFailures = artifacts
    .filter((artifact) => failedFetchStatuses.has(artifact.metadata.fetch_status))
    .slice(0, EVIDENCE_REPLAY_LIMITS.retrievalFailures)
    .map((artifact) => ({
      artifactId: artifact.id,
      title: truncateText(artifact.title),
      url: artifact.url,
      adapter: artifact.adapter,
      sourcePriority: artifact.sourcePriority,
      sourceTier: artifact.sourceTier ?? "unknown",
      fetchStatus: artifact.metadata.fetch_status as "blocked" | "timeout" | "error",
      blockReason: artifact.metadata.block_reason,
      bypassLevel: artifact.metadata.bypass_level,
      loginRequired: artifact.metadata.login_required,
      sourceLabel: artifact.metadata.source_label
    }));

  return {
    version: "v0",
    limits: EVIDENCE_REPLAY_LIMITS,
    topArtifacts: artifacts
      .map((item, index) => ({ item, index }))
      .sort((left, right) =>
        compareByIndex(left, right, (leftArtifact, rightArtifact) => {
          const leftFailed = failedFetchStatuses.has(leftArtifact.metadata.fetch_status) ? 1 : 0;
          const rightFailed = failedFetchStatuses.has(rightArtifact.metadata.fetch_status) ? 1 : 0;
          return (
            leftFailed - rightFailed ||
            rankSourcePriority(leftArtifact.sourcePriority) -
              rankSourcePriority(rightArtifact.sourcePriority) ||
            rankSourceTier(leftArtifact.sourceTier) - rankSourceTier(rightArtifact.sourceTier)
          );
        })
      )
      .slice(0, EVIDENCE_REPLAY_LIMITS.topArtifacts)
      .map(({ item }) => ({
        id: item.id,
        title: truncateText(item.title),
        url: item.url,
        adapter: item.adapter,
        sourceType: item.sourceType,
        sourcePriority: item.sourcePriority,
        sourceTier: item.sourceTier ?? "unknown",
        trustHint: inferTrustHint({
          sourcePriority: item.sourcePriority,
          sourceTier: item.sourceTier
        }),
        fetchStatus: item.metadata.fetch_status,
        retrievedAt: item.retrievedAt,
        publishedAt: item.publishedAt,
        snippet: truncateText(item.snippet)
      })),
    topClaims: claims
      .map((item, index) => ({ item, index }))
      .sort((left, right) =>
        compareByIndex(left, right, (leftClaim, rightClaim) => {
          const leftInternal = leftClaim.sourceTier === "internal" ? 1 : 0;
          const rightInternal = rightClaim.sourceTier === "internal" ? 1 : 0;
          return (
            leftInternal - rightInternal ||
            rankTrustTier(leftClaim.trustTier) - rankTrustTier(rightClaim.trustTier) ||
            rankSourcePriority(leftClaim.provenance?.sourcePriority) -
              rankSourcePriority(rightClaim.provenance?.sourcePriority)
          );
        })
      )
      .slice(0, EVIDENCE_REPLAY_LIMITS.topClaims)
      .map(({ item }) => {
        const artifact = artifactById.get(item.artifactId);
        return {
          id: item.id,
          text: truncateText(item.text),
          stance: item.stance,
          topicKey: item.topicKey,
          artifactId: item.artifactId,
          artifactTitle: truncateText(item.provenance?.artifactTitle ?? artifact?.title),
          sourcePriority: item.provenance?.sourcePriority ?? artifact?.sourcePriority,
          sourceTier: item.sourceTier ?? item.provenance?.sourceTier ?? artifact?.sourceTier,
          trustTier: item.trustTier ?? item.provenance?.trustTier,
          citationIds: item.citationIds
        };
      }),
    topCitations: citations
      .map((item, index) => ({ item, index }))
      .sort((left, right) =>
        compareByIndex(
          left,
          right,
          (leftCitation, rightCitation) =>
            rankSourcePriority(leftCitation.priority) - rankSourcePriority(rightCitation.priority)
        )
      )
      .slice(0, EVIDENCE_REPLAY_LIMITS.topCitations)
      .map(({ item }) => ({
        id: item.id,
        artifactId: item.artifactId,
        title: truncateText(item.title),
        url: item.url,
        priority: item.priority,
        sourceTier: item.sourceTier,
        trustTier: item.trustTier,
        retrievedAt: item.retrievedAt,
        publishedAt: item.publishedAt
      })),
    contradictions: contradictions
      .slice(0, EVIDENCE_REPLAY_LIMITS.contradictions)
      .map((contradiction) => ({
        id: contradiction.id,
        claimIds: contradiction.claimIds,
        status: contradiction.status,
        resolution: contradiction.resolution,
        kind: contradiction.kind,
        tierA: contradiction.tierA,
        tierB: contradiction.tierB
      })),
    retrievalFailures,
    sourceQualitySummary: {
      artifactCount: artifacts.length,
      claimCount: claims.length,
      citationCount: citations.length,
      contradictionCount: contradictions.length,
      retrievalFailureCount: retrievalFailures.length,
      sourcePriorityCounts: diagnostics?.sourcePriorityCounts,
      sourceTierCounts: diagnostics?.sourceTierCounts,
      hasOfficialOrPrimaryEvidence: diagnostics?.hasOfficialOrPrimaryEvidence,
      weakEvidence: diagnostics?.weakEvidence,
      falseConvergenceRisk: diagnostics?.falseConvergenceRisk
    },
    unresolvedEvidenceGaps: buildUnresolvedEvidenceGaps(diagnostics)
  };
}

function buildRetrievalAttemptGaps(run: RunRecord): RetrievalAttemptGaps {
  const gaps = run.retrievalAttemptGaps ?? null;
  if (!gaps) return null;

  return {
    version: "v0",
    emptyResults: gaps.emptyResults
      .slice(0, RETRIEVAL_ATTEMPT_GAP_LIMITS.emptyResults)
      .map((result) => ({
        adapter: result.adapter,
        url: result.url ? truncateText(result.url) : undefined,
        rule: result.rule ? truncateText(result.rule) : undefined,
        sourceType: result.sourceType,
        isFallback: result.isFallback,
        reason: result.reason,
        timestamp: result.timestamp
      })),
    droppedAttempts: gaps.droppedAttempts
      .slice(0, RETRIEVAL_ATTEMPT_GAP_LIMITS.droppedAttempts)
      .map((attempt) => ({
        reason: attempt.reason,
        count: attempt.count,
        adapter: attempt.adapter,
        sourceType: attempt.sourceType
      })),
    summary: gaps.summary
  };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (!result.includes(value)) result.push(value);
  }
  return result;
}

function parseMetadataInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isUsableFollowArtifact(artifact: RunRecord["artifacts"][number]): boolean {
  const fetchStatus = artifact.metadata.fetch_status;
  return fetchStatus === undefined || fetchStatus === "success" || fetchStatus === "ok" || fetchStatus === "partial";
}

function toUsableFollowArtifact(artifact: RunRecord["artifacts"][number]): {
  artifactId: string;
  url: string;
  sourcePriority?: string;
  sourceTier?: string;
  repairStage?: string;
  repairSourceHostClass?: string;
  repairFollowRank?: string;
} {
  return {
    artifactId: artifact.id,
    url: truncateText(artifact.url),
    sourcePriority: artifact.sourcePriority,
    sourceTier: artifact.sourceTier ?? "unknown",
    repairStage: artifact.metadata.repair_stage,
    repairSourceHostClass: artifact.metadata.repair_source_host_class,
    repairFollowRank: artifact.metadata.repair_follow_rank
  };
}

function toFailedFollowAttempt(artifact: RunRecord["artifacts"][number]) {
  return {
    ...toUsableFollowArtifact(artifact),
    fetchStatus: artifact.metadata.fetch_status
  };
}

function buildRepairAttempts(
  run: RunRecord,
  diagnostics: EvidenceDiagnostics
): RepairAttempts {
  const repairArtifacts = (run.artifacts ?? []).filter(
    (artifact) => artifact.metadata.repair_pass === "source_coverage_v1"
  );
  const discoveryArtifacts = repairArtifacts.filter(
    (artifact) => artifact.metadata.repair_stage === "discovery"
  );
  const fallbackArtifacts = repairArtifacts.filter(
    (artifact) => artifact.metadata.repair_stage === "discovery_fallback"
  );
  const evidenceArtifacts = repairArtifacts.filter(
    (artifact) => artifact.metadata.repair_stage === "evidence"
  );
  const usableEvidenceArtifacts = evidenceArtifacts.filter(isUsableFollowArtifact);
  const failedFollowArtifacts = evidenceArtifacts.filter((artifact) => !isUsableFollowArtifact(artifact));
  const attempted = repairArtifacts.length > 0;
  const reason = repairArtifacts.find((artifact) => artifact.metadata.repair_reason)?.metadata
    .repair_reason;
  const discoverySource = discoveryArtifacts.find(
    (artifact) => typeof artifact.metadata.repair_discovery_source === "string"
  )?.metadata.repair_discovery_source;
  const blockedPrimary = discoveryArtifacts.some(
    (artifact) => artifact.metadata.fetch_status === "blocked"
  );
  const fallbackAttemptedFromPrimary = discoveryArtifacts.some(
    (artifact) => artifact.metadata.repair_fallback_attempted === "true"
  );
  const rawCandidateCounts = fallbackArtifacts
    .map((artifact) => parseMetadataInt(artifact.metadata.repair_candidate_count))
    .filter((value): value is number => typeof value === "number");
  const fallbackCandidateCountFromPrimary = discoveryArtifacts
    .map((artifact) => parseMetadataInt(artifact.metadata.repair_fallback_candidate_count))
    .find((value): value is number => typeof value === "number");
  const fallbackAllowedUrlCountFromPrimary = discoveryArtifacts
    .map((artifact) => parseMetadataInt(artifact.metadata.repair_fallback_allowed_url_count))
    .find((value): value is number => typeof value === "number");
  const fallbackRawSourcesCheckedFromPrimary = discoveryArtifacts
    .map((artifact) => parseMetadataInt(artifact.metadata.repair_fallback_raw_sources_checked))
    .find((value): value is number => typeof value === "number");
  const candidateCount = discoveryArtifacts
    .map((artifact) => parseMetadataInt(artifact.metadata.repair_candidate_count))
    .find((value): value is number => typeof value === "number");
  const allowedUrlCount = discoveryArtifacts
    .map((artifact) => parseMetadataInt(artifact.metadata.repair_allowed_url_count))
    .find((value): value is number => typeof value === "number");
  const candidateUrlCount = rawCandidateCounts.length > 0
    ? rawCandidateCounts.reduce((sum, count) => sum + count, 0)
    : fallbackCandidateCountFromPrimary;
  const fallbackSourceArtifactIds = fallbackArtifacts.length > 0
    ? fallbackArtifacts.map((artifact) => artifact.id)
    : discoveryArtifacts
        .filter((artifact) => artifact.metadata.repair_fallback_attempted === "true")
        .map((artifact) => artifact.id);
  const fallbackAttempted = fallbackArtifacts.length > 0 || fallbackAttemptedFromPrimary;

  let outcome: RepairAttempts["sourceCoverage"]["outcome"] = "not_attempted";
  if (attempted) {
    if (usableEvidenceArtifacts.length > 0) {
      outcome = diagnostics?.hasOfficialOrPrimaryEvidence ? "followed_evidence" : "no_improvement";
    } else if (fallbackAttempted) {
      outcome = "no_candidates";
    } else if (blockedPrimary) {
      outcome = "blocked_primary";
    } else {
      outcome = "no_candidates";
    }
  }

  return {
    version: "v0",
    sourceCoverage: {
      attempted,
      reason,
      discoverySource,
      candidateCount,
      allowedUrlCount,
      primaryDiscovery: {
        attempted: discoveryArtifacts.length > 0,
        blocked: discoveryArtifacts.length > 0 ? blockedPrimary : undefined,
        artifactIds: discoveryArtifacts.map((artifact) => artifact.id),
        sourceTiers: uniqueStrings(discoveryArtifacts.map((artifact) => artifact.sourceTier ?? "unknown")),
        urls: discoveryArtifacts.map((artifact) => truncateText(artifact.url))
      },
      fallbackDiscovery: {
        attempted: fallbackAttempted,
        candidateUrlCount,
        allowedUrlCount: fallbackAllowedUrlCountFromPrimary,
        rawSourcesChecked: fallbackRawSourcesCheckedFromPrimary,
        sourceArtifactIds: fallbackSourceArtifactIds,
        note:
          fallbackAttempted && candidateUrlCount === undefined
            ? "fallback candidate count unavailable from persisted repair metadata"
            : undefined
      },
      followedEvidence: {
        count: usableEvidenceArtifacts.length,
        artifactIds: usableEvidenceArtifacts.map((artifact) => artifact.id),
        sourcePriorities: uniqueStrings(usableEvidenceArtifacts.map((artifact) => artifact.sourcePriority)),
        sourceTiers: uniqueStrings(usableEvidenceArtifacts.map((artifact) => artifact.sourceTier ?? "unknown")),
        urls: usableEvidenceArtifacts.map((artifact) => truncateText(artifact.url)),
        artifacts: usableEvidenceArtifacts.map(toUsableFollowArtifact)
      },
      failedFollowAttempts: {
        count: failedFollowArtifacts.length,
        artifacts: failedFollowArtifacts.map(toFailedFollowAttempt)
      },
      outcome
    }
  };
}

export function buildCliBundle(params: {
  project: Project;
  latestRun: RunRecord;
  insights: Pick<
    ProjectInsightPatch & { contradictionIds?: string[] },
    "repeatedProblems" | "repeatedPatterns" | "competitorSignals" | "contradictionIds"
  >;
  decisionHistory: DecisionHistoryItem[];
  relatedRuns?: CliBridgeBundle["kb"]["relatedRuns"];
  promotionCandidates?: ProjectRecord["promotionCandidates"];
  decisionHistorySummary?: CliBridgeBundle["kb"]["decisionHistorySummary"];
  recentContradictions?: CliBridgeBundle["kb"]["recentContradictions"];
  projectInsightSummary?: CliBridgeBundle["kb"]["projectInsightSummary"];
  bridgeConfig: {
    provider: CliBridgeProvider;
    mode: CliBridgeMode;
  };
  now?: string;
}): CliBridgeBundle {
  const generatedAt = params.now ?? new Date().toISOString();
  const evidenceSummary = params.latestRun.evidenceSummary;
  const evidenceDiagnostics = evidenceSummary
    ? {
        decisiveEvidenceScore: evidenceSummary.decisiveEvidenceScore,
        falseConvergenceRisk: evidenceSummary.falseConvergenceRisk,
        convergenceRiskReasons: evidenceSummary.convergenceRiskReasons,
        counterevidenceChecked: evidenceSummary.counterevidenceChecked,
        supportOnlyEvidence: evidenceSummary.supportOnlyEvidence,
        weakEvidence: evidenceSummary.weakEvidence,
        sourcePriorityCounts: evidenceSummary.sourcePriorityCounts,
        sourceTierCounts: evidenceSummary.sourceTierCounts,
        sourcePriorityDiversity: evidenceSummary.sourcePriorityDiversity,
        hasOfficialOrPrimaryEvidence: evidenceSummary.hasOfficialOrPrimaryEvidence,
        aggregatorOnlyEvidence: evidenceSummary.aggregatorOnlyEvidence,
        sourceCoverageWarnings: evidenceSummary.sourceCoverageWarnings
      }
    : null;

  if (!params.latestRun.decision) {
    throw new Error("latestRun.decision is required for cli bundle");
  }

  return {
    project: {
      id: params.project.id,
      name: params.project.name,
      description: params.project.description
    },
    latestRun: {
      id: params.latestRun.run.id,
      decision: params.latestRun.decision.value,
      confidence: params.latestRun.decision.confidence,
      why: params.latestRun.decision.why,
      blockingUnknowns: params.latestRun.decision.blockingUnknowns
    },
    insights: {
      repeatedProblems: params.insights.repeatedProblems,
      solutionPatterns: params.insights.repeatedPatterns,
      competitorSignals: params.insights.competitorSignals,
      conflicts: params.insights.contradictionIds ?? []
    },
    evidenceDiagnostics,
    evidenceReplay: buildEvidenceReplay(params.latestRun, evidenceDiagnostics),
    retrievalAttemptGaps: buildRetrievalAttemptGaps(params.latestRun),
    repairAttempts: buildRepairAttempts(params.latestRun, evidenceDiagnostics),
    runtimeProvenance: params.latestRun.runtimeProvenance ?? null,
    decisionHistory: params.decisionHistory,
    kb: {
      promotionCandidates: params.promotionCandidates ?? [],
      relatedRuns: params.relatedRuns ?? [],
      decisionHistorySummary: params.decisionHistorySummary ?? [],
      recentContradictions: params.recentContradictions ?? [],
      projectInsightSummary: params.projectInsightSummary ?? {}
    },
    bridge: {
      provider: params.bridgeConfig.provider,
      mode: params.bridgeConfig.mode,
      generatedAt,
      projectId: params.project.id,
      runId: params.latestRun.run.id,
      schemaVersion: "cli-bridge-v1"
    }
  };
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- none";
}

function renderEvidenceDiagnostics(diagnostics: EvidenceDiagnostics): string {
  if (!diagnostics) {
    return "- none";
  }

  return [
    `- Decisiveness: ${diagnostics.decisiveEvidenceScore ?? "unknown"}`,
    `- False convergence risk: ${diagnostics.falseConvergenceRisk ?? "unknown"}`,
    `- Counterevidence checked: ${diagnostics.counterevidenceChecked ?? "unknown"}`,
    `- Weak evidence: ${diagnostics.weakEvidence ?? "unknown"}`,
    `- Source priority diversity: ${diagnostics.sourcePriorityDiversity ?? "unknown"}`,
    `- Official/primary evidence: ${diagnostics.hasOfficialOrPrimaryEvidence ?? "unknown"}`,
    `- Aggregator-only evidence: ${diagnostics.aggregatorOnlyEvidence ?? "unknown"}`,
    `- Warnings: ${diagnostics.sourceCoverageWarnings?.join(", ") || "none"}`
  ].join("\n");
}

function renderRuntimeProvenance(provenance: RuntimeProvenance | null): string {
  if (!provenance) {
    return "- not available";
  }

  return [
    `- Git head: ${provenance.gitHead ?? "unknown"}`,
    `- Node version: ${provenance.nodeVersion}`,
    `- Process start time: ${provenance.processStartTime}`,
    `- Entrypoint: ${provenance.entrypoint ?? "unknown"}`
  ].join("\n");
}

function renderEvidenceReplay(replay: EvidenceReplay): string {
  const artifacts =
    replay.topArtifacts.length > 0
      ? replay.topArtifacts
          .map(
            (artifact) =>
              `- [${artifact.sourcePriority ?? "unknown"}/${artifact.sourceTier ?? "unknown"}] ${artifact.title} — ${artifact.url}\n` +
              `  - adapter: ${artifact.adapter ?? "unknown"}; fetch: ${artifact.fetchStatus ?? "unknown"}; trust: ${artifact.trustHint}\n` +
              `  - snippet: ${artifact.snippet || "none"}`
          )
          .join("\n")
      : "- none";
  const claims =
    replay.topClaims.length > 0
      ? replay.topClaims
          .map(
            (claim) =>
              `- ${claim.stance} / ${claim.trustTier ?? "unknown"} — ${claim.text}\n` +
              `  - artifact: ${claim.artifactId ?? "unknown"}${claim.artifactTitle ? ` / ${claim.artifactTitle}` : ""}\n` +
              `  - citations: ${claim.citationIds.join(", ") || "none"}`
          )
          .join("\n")
      : "- none";
  const citations =
    replay.topCitations.length > 0
      ? replay.topCitations
          .map(
            (citation) =>
              `- [${citation.priority ?? "unknown"}] ${citation.title ?? citation.id}${citation.url ? ` — ${citation.url}` : ""}\n` +
              `  - artifact: ${citation.artifactId ?? "unknown"}; tier: ${citation.sourceTier ?? "unknown"}; trust: ${citation.trustTier ?? "unknown"}`
          )
          .join("\n")
      : "- none";
  const failures =
    replay.retrievalFailures.length > 0
      ? replay.retrievalFailures
          .map(
            (failure) =>
              `- ${failure.fetchStatus} — ${failure.title ?? failure.artifactId}${failure.url ? ` — ${failure.url}` : ""}\n` +
              `  - adapter: ${failure.adapter ?? "unknown"}; block: ${failure.blockReason ?? "none"}; bypass: ${failure.bypassLevel ?? "unknown"}`
          )
          .join("\n")
      : "- none";
  const gaps =
    replay.unresolvedEvidenceGaps.length > 0
      ? replay.unresolvedEvidenceGaps.map((gap) => `- ${gap}`).join("\n")
      : "- none";

  return [
    "### Top Artifacts",
    artifacts,
    "",
    "### Top Claims",
    claims,
    "",
    "### Top Citations",
    citations,
    "",
    "### Retrieval Gaps / Failures",
    failures,
    "",
    "### Unresolved Evidence Gaps",
    gaps
  ].join("\n");
}

function renderRetrievalAttemptGaps(gaps: RetrievalAttemptGaps): string {
  if (!gaps) {
    return "No retrieval attempt gaps recorded.";
  }

  const emptyResults =
    gaps.emptyResults.length > 0
      ? gaps.emptyResults
          .map(
            (result) =>
              `- adapter: ${result.adapter}\n` +
              `  - sourceType: ${result.sourceType ?? "unknown"}\n` +
              `  - reason: ${result.reason}\n` +
              `  - isFallback: ${result.isFallback}\n` +
              `  - url/query: ${result.url ?? "unknown"}`
          )
          .join("\n")
      : "- none";
  const droppedAttempts =
    gaps.droppedAttempts.length > 0
      ? gaps.droppedAttempts
          .map(
            (attempt) =>
              `- reason: ${attempt.reason}\n` +
              `  - count: ${attempt.count ?? "unknown"}\n` +
              `  - adapter: ${attempt.adapter ?? "unknown"}\n` +
              `  - sourceType: ${attempt.sourceType ?? "unknown"}`
          )
          .join("\n")
      : "- none";

  return [
    `- Empty adapter results: ${gaps.summary.emptyResultCount}`,
    `- Dropped attempts: ${gaps.summary.droppedAttemptCount}`,
    "",
    "### Empty Results",
    emptyResults,
    "",
    "### Dropped Attempts",
    droppedAttempts
  ].join("\n");
}

function renderRepairAttempts(repairAttempts: RepairAttempts): string {
  const sourceCoverage = repairAttempts.sourceCoverage;
  const primaryStatus = !sourceCoverage.primaryDiscovery.attempted
    ? "not attempted"
    : sourceCoverage.primaryDiscovery.blocked
      ? "blocked"
      : "attempted";
  const fallbackStatus = !sourceCoverage.fallbackDiscovery.attempted
    ? "not visible"
    : sourceCoverage.fallbackDiscovery.candidateUrlCount === undefined
      ? "partial"
      : "visible";

  const primaryArtifacts =
    sourceCoverage.primaryDiscovery.artifactIds.length > 0
      ? sourceCoverage.primaryDiscovery.artifactIds
          .map((artifactId, index) => {
            const url = sourceCoverage.primaryDiscovery.urls[index] ?? "unknown";
            return `- ${artifactId} — ${url}`;
          })
          .join("\n")
      : "- none";
  const fallbackArtifacts =
    sourceCoverage.fallbackDiscovery.sourceArtifactIds.length > 0
      ? sourceCoverage.fallbackDiscovery.sourceArtifactIds.map((artifactId) => `- ${artifactId}`).join("\n")
      : "- none";
  const followedEvidence =
    sourceCoverage.followedEvidence.artifacts.length > 0
      ? sourceCoverage.followedEvidence.artifacts
          .map((artifact) => {
            return (
              `- ${artifact.artifactId} — ${artifact.url}\n` +
              `  - priority: ${artifact.sourcePriority ?? "unknown"}; tier: ${artifact.sourceTier ?? "unknown"}; hostClass: ${artifact.repairSourceHostClass ?? "unknown"}; stage: ${artifact.repairStage ?? "unknown"}; followRank: ${artifact.repairFollowRank ?? "unknown"}`
            );
          })
          .join("\n")
      : "- none";
  const failedFollowAttempts =
    sourceCoverage.failedFollowAttempts.artifacts.length > 0
      ? sourceCoverage.failedFollowAttempts.artifacts
          .map((artifact) => {
            return (
              `- ${artifact.artifactId} — ${artifact.url}\n` +
              `  - fetchStatus: ${artifact.fetchStatus ?? "unknown"}; priority: ${artifact.sourcePriority ?? "unknown"}; tier: ${artifact.sourceTier ?? "unknown"}; hostClass: ${artifact.repairSourceHostClass ?? "unknown"}; followRank: ${artifact.repairFollowRank ?? "unknown"}`
            );
          })
          .join("\n")
      : "- none";

  return [
    `- Source coverage repair attempted: ${sourceCoverage.attempted ? "yes" : "no"}`,
    `- Reason: ${sourceCoverage.reason ?? "none"}`,
    `- Discovery source: ${sourceCoverage.discoverySource ?? "none"}`,
    `- Primary discovery: ${primaryStatus}`,
    `- Fallback discovery: ${fallbackStatus}`,
    sourceCoverage.candidateCount !== undefined
      ? `- Discovery candidates: ${sourceCoverage.candidateCount}`
      : null,
    sourceCoverage.allowedUrlCount !== undefined
      ? `- Discovery allowed URLs: ${sourceCoverage.allowedUrlCount}`
      : null,
    sourceCoverage.fallbackDiscovery.candidateUrlCount !== undefined
      ? `- Fallback candidate count: ${sourceCoverage.fallbackDiscovery.candidateUrlCount}`
      : null,
    sourceCoverage.fallbackDiscovery.allowedUrlCount !== undefined
      ? `- Fallback allowed URL count: ${sourceCoverage.fallbackDiscovery.allowedUrlCount}`
      : null,
    sourceCoverage.fallbackDiscovery.rawSourcesChecked !== undefined
      ? `- Fallback raw sources checked: ${sourceCoverage.fallbackDiscovery.rawSourcesChecked}`
      : null,
    `- Followed evidence count: ${sourceCoverage.followedEvidence.count}`,
    `- Failed follow attempts: ${sourceCoverage.failedFollowAttempts.count}`,
    `- Outcome: ${sourceCoverage.outcome}`,
    sourceCoverage.fallbackDiscovery.note ? `- Note: ${sourceCoverage.fallbackDiscovery.note}` : null,
    "",
    "### Primary Discovery",
    primaryArtifacts,
    "",
    "### Fallback Discovery",
    fallbackArtifacts,
    "",
    "### Followed Evidence",
    followedEvidence,
    "",
    "### Failed Follow Attempts",
    failedFollowAttempts
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function renderCliBundleMarkdown(bundle: CliBridgeBundle): string {
  const history =
    bundle.decisionHistory.length > 0
      ? bundle.decisionHistory
          .map(
            (item) =>
              `- ${item.createdAt} — ${item.decision} (${item.confidence})\n` +
              `  - why: ${item.why}\n` +
              `  - run: ${item.runId}\n` +
              `  - blocking unknowns: ${item.blockingUnknownCount}`
          )
          .join("\n")
      : "- none";
  const promotionCandidates =
    bundle.kb.promotionCandidates.length > 0
      ? bundle.kb.promotionCandidates
          .map((item) => `- ${item.title} (${item.status})`)
          .join("\n")
      : "- none";
  const relatedRuns =
    bundle.kb.relatedRuns.length > 0
      ? bundle.kb.relatedRuns
          .map(
            (item) =>
              `- ${item.createdAt} — ${item.decision}\n` +
              `  - run: ${item.runId}\n` +
              `  - title: ${item.title}\n` +
              `  - why: ${item.why}`
          )
          .join("\n")
      : "- none";
  const decisionHistorySummary =
    bundle.kb.decisionHistorySummary.length > 0
      ? bundle.kb.decisionHistorySummary
          .map(
            (item) =>
              `- ${item.createdAt} — ${item.decision}\n` +
              `  - run: ${item.runId}\n` +
              `  - title: ${item.title}`
          )
          .join("\n")
      : "- none";
  const recentContradictions =
    bundle.kb.recentContradictions.length > 0
      ? bundle.kb.recentContradictions
          .map(
            (item) =>
              `- ${item.contradictionId}\n` +
              `  - run: ${item.runId}\n` +
              `  - status: ${item.status}\n` +
              `  - resolution: ${item.resolution}`
          )
          .join("\n")
      : "- none";
  const projectInsightSummary = [
    bundle.kb.projectInsightSummary.repeatedProblems
      ? `- repeated problems: ${bundle.kb.projectInsightSummary.repeatedProblems}`
      : null,
    bundle.kb.projectInsightSummary.solutionPatterns
      ? `- solution patterns: ${bundle.kb.projectInsightSummary.solutionPatterns}`
      : null,
    bundle.kb.projectInsightSummary.competitorSignals
      ? `- competitor signals: ${bundle.kb.projectInsightSummary.competitorSignals}`
      : null,
    bundle.kb.projectInsightSummary.conflicts
      ? `- conflicts: ${bundle.kb.projectInsightSummary.conflicts}`
      : null
  ]
    .filter(Boolean)
    .join("\n") || "- none";

  return [
    `# ${bundle.project.name} Bundle`,
    "",
    "## Project",
    `- id: ${bundle.project.id}`,
    `- name: ${bundle.project.name}`,
    `- description: ${bundle.project.description}`,
    "",
    "## Latest Run",
    `- run id: ${bundle.latestRun.id}`,
    `- decision: ${bundle.latestRun.decision}`,
    `- confidence: ${bundle.latestRun.confidence}`,
    `- why: ${bundle.latestRun.why}`,
    `- blocking unknowns: ${bundle.latestRun.blockingUnknowns.join(", ") || "none"}`,
    "",
    "## Project Insights",
    "### Repeated Problems",
    renderList(bundle.insights.repeatedProblems),
    "",
    "### Solution Patterns",
    renderList(bundle.insights.solutionPatterns),
    "",
    "### Competitor Signals",
    renderList(bundle.insights.competitorSignals),
    "",
    "### Conflicts",
    renderList(bundle.insights.conflicts),
    "",
    "## Evidence Diagnostics",
    renderEvidenceDiagnostics(bundle.evidenceDiagnostics),
    "",
    "## Evidence Replay",
    renderEvidenceReplay(bundle.evidenceReplay),
    "",
    "## Retrieval Attempt Gaps",
    renderRetrievalAttemptGaps(bundle.retrievalAttemptGaps),
    "",
    "## Repair Attempts",
    renderRepairAttempts(bundle.repairAttempts),
    "",
    "## Runtime Provenance",
    renderRuntimeProvenance(bundle.runtimeProvenance),
    "",
    "## Decision History",
    history,
    "",
    "## KB Context",
    "### Promotion Candidates",
    promotionCandidates,
    "",
    "### Related Runs",
    relatedRuns,
    "",
    "### Decision History Summary",
    decisionHistorySummary,
    "",
    "### Recent Contradictions",
    recentContradictions,
    "",
    "### Project Insight Summary",
    projectInsightSummary,
    "",
    "## Instructions for External CLI",
    `- provider: ${bundle.bridge.provider}`,
    `- mode: ${bundle.bridge.mode}`,
    "- Treat internal decision as source of truth",
    "- Return advisory output only",
    "- Do not overwrite decision",
    "- Respond with:",
    "  - external_summary",
    "  - suggested_next_actions",
    "  - notes"
  ].join("\n");
}
