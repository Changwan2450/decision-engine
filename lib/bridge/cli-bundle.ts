import type { DecisionHistoryItem } from "@/lib/orchestrator/decision-history";
import type { ProjectInsightPatch } from "@/lib/orchestrator/insights";
import type { Project } from "@/lib/domain/projects";
import type { RunRecord, ProjectRecord } from "@/lib/storage/schema";

export type CliBridgeProvider = "claude" | "codex";
export type CliBridgeMode = "prompt_only" | "cli_execute";

type RuntimeProvenance = NonNullable<RunRecord["runtimeProvenance"]>;

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
    evidenceDiagnostics: evidenceSummary
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
      : null,
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
