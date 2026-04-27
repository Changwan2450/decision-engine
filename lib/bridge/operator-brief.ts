export type OperatorBriefConfidenceStatus =
  | "usable"
  | "usable_with_caution"
  | "not_ready"
  | "inconclusive";

export type OperatorBrief = {
  version: "v0";
  headline: string;
  decisionSummary: string;
  confidenceStatus: OperatorBriefConfidenceStatus;
  evidenceStatus: {
    decision: "go" | "no_go" | "unclear";
    confidence: "low" | "medium" | "high";
    decisiveEvidenceScore?: number;
    falseConvergenceRisk?: boolean;
    hasOfficialOrPrimaryEvidence?: boolean;
    counterevidenceChecked?: boolean;
    weakEvidence?: boolean;
  };
  keyFindings: string[];
  strongestEvidence: Array<{
    artifactId: string;
    title?: string;
    url?: string;
    sourcePriority?: string;
    sourceTier?: string;
    trustTier?: string;
  }>;
  repairSummary: {
    sourceCoverageOutcome: string;
    counterevidenceOutcome: string;
    sourceCoverageFollowedCount: number;
    counterevidenceFollowedCount: number;
    failedFollowAttemptCount: number;
  };
  unresolvedGaps: string[];
  operatorNextActions: string[];
  aiHandoffInstructions: string[];
  doNotOverclaim: string[];
};

type EvidenceDiagnosticsInput = {
  decisiveEvidenceScore?: number;
  falseConvergenceRisk?: boolean;
  counterevidenceChecked?: boolean;
  weakEvidence?: boolean;
  hasOfficialOrPrimaryEvidence?: boolean;
  sourceCoverageWarnings?: string[];
} | null;

type EvidenceReplayInput = {
  topClaims: Array<{
    text: string;
  }>;
  topCitations: Array<{
    artifactId?: string;
    title?: string;
    url?: string;
    priority?: string;
    sourceTier?: string;
    trustTier?: string;
  }>;
  topArtifacts: Array<{
    id: string;
    title?: string;
    url?: string;
    sourcePriority?: string;
    sourceTier?: string;
    trustHint?: string;
    fetchStatus?: string;
  }>;
  unresolvedEvidenceGaps: string[];
};

type RepairAttemptsInput = {
  sourceCoverage: {
    outcome: string;
    followedEvidence: {
      count: number;
      artifacts: Array<{
        artifactId: string;
        url?: string;
        sourcePriority?: string;
        sourceTier?: string;
      }>;
    };
    failedFollowAttempts: {
      count: number;
      artifacts: Array<{
        artifactId: string;
        url?: string;
        fetchStatus?: string;
      }>;
    };
  };
  counterevidence: {
    outcome: string;
    followedEvidence: {
      count: number;
      artifacts: Array<{
        artifactId: string;
        url?: string;
        sourcePriority?: string;
        sourceTier?: string;
        repairCounterevidenceKind?: string;
        fetchStatus?: string;
      }>;
    };
    failedFollowAttempts: {
      count: number;
      artifacts: Array<{
        artifactId: string;
        url?: string;
        fetchStatus?: string;
      }>;
    };
  };
};

type RetrievalAttemptGapsInput = {
  summary: {
    emptyResultCount: number;
    droppedAttemptCount: number;
  };
} | null;

export type OperatorBriefInput = {
  latestRun: {
    decision: "go" | "no_go" | "unclear";
    confidence: "low" | "medium" | "high";
    why: string;
    blockingUnknowns: string[];
  };
  evidenceDiagnostics: EvidenceDiagnosticsInput;
  evidenceReplay: EvidenceReplayInput;
  retrievalAttemptGaps: RetrievalAttemptGapsInput;
  repairAttempts: RepairAttemptsInput;
};

const SOURCE_PRIORITY_RANK: Record<string, number> = {
  official: 0,
  primary_data: 1,
  analysis: 2,
  community: 3
};

const SOURCE_TIER_RANK: Record<string, number> = {
  official: 0,
  primary: 1,
  internal: 2,
  community: 3,
  aggregator: 4,
  unknown: 5
};

const FAILED_FETCH_STATUSES = new Set(["blocked", "timeout", "error", "failed"]);
const SEARCH_HOST_PATTERNS = [
  "duckduckgo.com",
  "html.duckduckgo.com",
  "google.com/search",
  "bing.com/search",
  "s.jina.ai"
];

function truncateText(value: string | undefined, maxLength = 220): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function addUnique(target: string[], value: string | undefined, max = Number.POSITIVE_INFINITY) {
  const text = truncateText(value);
  if (!text || target.includes(text) || target.length >= max) return;
  target.push(text);
}

function rankPriority(value: string | undefined): number {
  return SOURCE_PRIORITY_RANK[value ?? ""] ?? 99;
}

function rankTier(value: string | undefined): number {
  return SOURCE_TIER_RANK[value ?? "unknown"] ?? SOURCE_TIER_RANK.unknown;
}

function isSearchPage(url: string | undefined): boolean {
  const normalized = (url ?? "").toLowerCase();
  return SEARCH_HOST_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function isUsableUrl(url: string | undefined, fetchStatus?: string): boolean {
  return Boolean(url) && !isSearchPage(url) && !FAILED_FETCH_STATUSES.has(fetchStatus ?? "");
}

function deriveConfidenceStatus(params: {
  latestRun: OperatorBriefInput["latestRun"];
  diagnostics: EvidenceDiagnosticsInput;
  repairAttempts: RepairAttemptsInput;
}): OperatorBriefConfidenceStatus {
  const { latestRun, diagnostics, repairAttempts } = params;
  if (!diagnostics) return "inconclusive";

  const hasBlockingUnknowns = latestRun.blockingUnknowns.length > 0;
  const blockingNotReady =
    latestRun.decision === "unclear" ||
    diagnostics.falseConvergenceRisk === true ||
    diagnostics.weakEvidence === true ||
    diagnostics.hasOfficialOrPrimaryEvidence === false ||
    hasBlockingUnknowns;
  if (blockingNotReady) return "not_ready";

  const repairPartial =
    ["failed_discovery", "no_candidates", "blocked_primary", "not_attempted"].includes(
      repairAttempts.sourceCoverage.outcome
    ) ||
    ["failed_discovery", "not_attempted", "checked_no_candidates"].includes(
      repairAttempts.counterevidence.outcome
    );

  if (
    latestRun.decision !== "unclear" &&
    (diagnostics.counterevidenceChecked === false || repairPartial)
  ) {
    return "usable_with_caution";
  }

  if (
    latestRun.decision !== "unclear" &&
    (diagnostics.decisiveEvidenceScore ?? 0) >= 0.75 &&
    diagnostics.falseConvergenceRisk === false &&
    diagnostics.hasOfficialOrPrimaryEvidence === true &&
    diagnostics.weakEvidence === false &&
    !hasBlockingUnknowns
  ) {
    return "usable";
  }

  return latestRun.decision === "unclear" ? "inconclusive" : "usable_with_caution";
}

function buildStrongestEvidence(params: {
  repairAttempts: RepairAttemptsInput;
  evidenceReplay: EvidenceReplayInput;
}): OperatorBrief["strongestEvidence"] {
  const byArtifactId = new Map(
    params.evidenceReplay.topArtifacts.map((artifact) => [artifact.id, artifact])
  );
  const failedRepairArtifactIds = new Set([
    ...params.repairAttempts.sourceCoverage.failedFollowAttempts.artifacts.map(
      (artifact) => artifact.artifactId
    ),
    ...params.repairAttempts.counterevidence.failedFollowAttempts.artifacts.map(
      (artifact) => artifact.artifactId
    )
  ]);
  const evidence: OperatorBrief["strongestEvidence"] = [];
  const seen = new Set<string>();
  const add = (item: OperatorBrief["strongestEvidence"][number]) => {
    if (!item.artifactId || seen.has(item.artifactId) || evidence.length >= 5) return;
    if (failedRepairArtifactIds.has(item.artifactId)) return;
    if (!isUsableUrl(item.url)) return;
    seen.add(item.artifactId);
    evidence.push({
      artifactId: item.artifactId,
      title: truncateText(item.title),
      url: truncateText(item.url),
      sourcePriority: item.sourcePriority,
      sourceTier: item.sourceTier,
      trustTier: item.trustTier
    });
  };

  for (const artifact of params.repairAttempts.sourceCoverage.followedEvidence.artifacts) {
    const replayArtifact = byArtifactId.get(artifact.artifactId);
    add({
      artifactId: artifact.artifactId,
      title: replayArtifact?.title,
      url: artifact.url,
      sourcePriority: artifact.sourcePriority,
      sourceTier: artifact.sourceTier,
      trustTier: replayArtifact?.trustHint
    });
  }

  const rankedCitations = [...params.evidenceReplay.topCitations].sort((left, right) => {
    return (
      rankPriority(left.priority) - rankPriority(right.priority) ||
      rankTier(left.sourceTier) - rankTier(right.sourceTier)
    );
  });
  for (const citation of rankedCitations) {
    if (!citation.artifactId) continue;
    const replayArtifact = byArtifactId.get(citation.artifactId);
    if (FAILED_FETCH_STATUSES.has(replayArtifact?.fetchStatus ?? "")) continue;
    add({
      artifactId: citation.artifactId,
      title: citation.title,
      url: citation.url,
      sourcePriority: citation.priority,
      sourceTier: citation.sourceTier,
      trustTier: citation.trustTier ?? replayArtifact?.trustHint
    });
  }

  const rankedArtifacts = [...params.evidenceReplay.topArtifacts].sort((left, right) => {
    const leftFailed = FAILED_FETCH_STATUSES.has(left.fetchStatus ?? "") ? 1 : 0;
    const rightFailed = FAILED_FETCH_STATUSES.has(right.fetchStatus ?? "") ? 1 : 0;
    return (
      leftFailed - rightFailed ||
      rankPriority(left.sourcePriority) - rankPriority(right.sourcePriority) ||
      rankTier(left.sourceTier) - rankTier(right.sourceTier)
    );
  });
  for (const artifact of rankedArtifacts) {
    if (FAILED_FETCH_STATUSES.has(artifact.fetchStatus ?? "")) continue;
    add({
      artifactId: artifact.id,
      title: artifact.title,
      url: artifact.url,
      sourcePriority: artifact.sourcePriority,
      sourceTier: artifact.sourceTier,
      trustTier: artifact.trustHint
    });
  }

  return evidence;
}

function buildUnresolvedGaps(params: OperatorBriefInput): string[] {
  const gaps: string[] = [];
  for (const gap of params.evidenceReplay.unresolvedEvidenceGaps) addUnique(gaps, gap, 8);
  for (const unknown of params.latestRun.blockingUnknowns) addUnique(gaps, unknown, 8);
  for (const warning of params.evidenceDiagnostics?.sourceCoverageWarnings ?? []) {
    addUnique(gaps, warning, 8);
  }
  if (
    ["failed_discovery", "no_candidates", "blocked_primary"].includes(
      params.repairAttempts.sourceCoverage.outcome
    )
  ) {
    addUnique(gaps, `source_coverage_${params.repairAttempts.sourceCoverage.outcome}`, 8);
  }
  if (
    ["failed_discovery", "not_attempted", "checked_no_candidates"].includes(
      params.repairAttempts.counterevidence.outcome
    )
  ) {
    addUnique(gaps, `counterevidence_${params.repairAttempts.counterevidence.outcome}`, 8);
  }
  if (params.retrievalAttemptGaps) {
    if (params.retrievalAttemptGaps.summary.emptyResultCount > 0) {
      addUnique(gaps, `empty_retrieval_results:${params.retrievalAttemptGaps.summary.emptyResultCount}`, 8);
    }
    if (params.retrievalAttemptGaps.summary.droppedAttemptCount > 0) {
      addUnique(gaps, `dropped_retrieval_attempts:${params.retrievalAttemptGaps.summary.droppedAttemptCount}`, 8);
    }
  }
  return gaps;
}

function buildNextActions(params: {
  confidenceStatus: OperatorBriefConfidenceStatus;
  diagnostics: EvidenceDiagnosticsInput;
  repairAttempts: RepairAttemptsInput;
}): string[] {
  const actions: string[] = [];
  if (params.diagnostics?.hasOfficialOrPrimaryEvidence === false) {
    addUnique(actions, "Collect or repair official/primary evidence before using this result.", 6);
  }
  if (params.diagnostics?.falseConvergenceRisk === true) {
    addUnique(
      actions,
      "Do not treat the conclusion as settled; rerun with stronger counterevidence/source coverage.",
      6
    );
  }
  if (["failed_discovery", "not_attempted"].includes(params.repairAttempts.counterevidence.outcome)) {
    addUnique(actions, "Retry counterevidence check or use a different discovery source.", 6);
  }
  if (["no_candidates", "failed_discovery"].includes(params.repairAttempts.sourceCoverage.outcome)) {
    addUnique(actions, "Retry source coverage discovery or provide seed official sources.", 6);
  }
  if (params.confidenceStatus === "usable" || params.confidenceStatus === "usable_with_caution") {
    addUnique(actions, "Use this brief as project input, but preserve listed gaps and citations.", 6);
  }
  if (actions.length === 0) {
    addUnique(actions, "Review Evidence Diagnostics and Repair Attempts before turning this into a project deliverable.", 6);
  }
  return actions;
}

function buildDoNotOverclaim(params: {
  diagnostics: EvidenceDiagnosticsInput;
  repairAttempts: RepairAttemptsInput;
}): string[] {
  const warnings: string[] = [];
  if (params.diagnostics?.falseConvergenceRisk === true) {
    addUnique(warnings, "Do not claim the conclusion is settled while falseConvergenceRisk is true.", 6);
  }
  if (
    params.diagnostics?.counterevidenceChecked === false ||
    ["failed_discovery", "not_attempted", "checked_no_candidates"].includes(
      params.repairAttempts.counterevidence.outcome
    )
  ) {
    addUnique(
      warnings,
      "Do not claim counterevidence was checked if counterevidenceChecked is false or repair failed.",
      6
    );
  }
  if (
    params.repairAttempts.sourceCoverage.failedFollowAttempts.count > 0 ||
    params.repairAttempts.counterevidence.failedFollowAttempts.count > 0
  ) {
    addUnique(warnings, "Do not treat failed follow attempts as evidence.", 6);
  }
  addUnique(
    warnings,
    "Do not treat limitations/risks as contradictions unless contradiction records exist.",
    6
  );
  return warnings;
}

export function buildOperatorBrief(params: OperatorBriefInput): OperatorBrief {
  const confidenceStatus = deriveConfidenceStatus({
    latestRun: params.latestRun,
    diagnostics: params.evidenceDiagnostics,
    repairAttempts: params.repairAttempts
  });
  const keyFindings: string[] = [];
  for (const claim of params.evidenceReplay.topClaims) addUnique(keyFindings, claim.text, 5);

  const repairSummary = {
    sourceCoverageOutcome: params.repairAttempts.sourceCoverage.outcome,
    counterevidenceOutcome: params.repairAttempts.counterevidence.outcome,
    sourceCoverageFollowedCount: params.repairAttempts.sourceCoverage.followedEvidence.count,
    counterevidenceFollowedCount: params.repairAttempts.counterevidence.followedEvidence.count,
    failedFollowAttemptCount:
      params.repairAttempts.sourceCoverage.failedFollowAttempts.count +
      params.repairAttempts.counterevidence.failedFollowAttempts.count
  };

  return {
    version: "v0",
    headline: `${params.latestRun.decision} / ${confidenceStatus}: ${truncateText(params.latestRun.why, 120) || "No decision summary available."}`,
    decisionSummary: `${params.latestRun.decision} (${params.latestRun.confidence}): ${truncateText(params.latestRun.why)}`,
    confidenceStatus,
    evidenceStatus: {
      decision: params.latestRun.decision,
      confidence: params.latestRun.confidence,
      decisiveEvidenceScore: params.evidenceDiagnostics?.decisiveEvidenceScore,
      falseConvergenceRisk: params.evidenceDiagnostics?.falseConvergenceRisk,
      hasOfficialOrPrimaryEvidence: params.evidenceDiagnostics?.hasOfficialOrPrimaryEvidence,
      counterevidenceChecked: params.evidenceDiagnostics?.counterevidenceChecked,
      weakEvidence: params.evidenceDiagnostics?.weakEvidence
    },
    keyFindings,
    strongestEvidence: buildStrongestEvidence(params),
    repairSummary,
    unresolvedGaps: buildUnresolvedGaps(params),
    operatorNextActions: buildNextActions({
      confidenceStatus,
      diagnostics: params.evidenceDiagnostics,
      repairAttempts: params.repairAttempts
    }),
    aiHandoffInstructions: [
      "Inspect Operator Brief first, then Evidence Diagnostics, Repair Attempts, and Evidence Replay.",
      "Preserve the listed gaps and confidence status when creating project deliverables.",
      "Use strongestEvidence and citations; do not use failedFollowAttempts as evidence.",
      "Do not overclaim beyond the doNotOverclaim warnings."
    ],
    doNotOverclaim: buildDoNotOverclaim({
      diagnostics: params.evidenceDiagnostics,
      repairAttempts: params.repairAttempts
    })
  };
}
