import { describe, expect, it } from "vitest";
import { buildCliBundle, renderCliBundleMarkdown } from "@/lib/bridge/cli-bundle";
import type { Project } from "@/lib/domain/projects";
import type { RunRecord } from "@/lib/storage/schema";
import type { DecisionHistoryItem } from "@/lib/orchestrator/decision-history";

const project: Project = {
  id: "project-1",
  name: "Decision Engine",
  description: "Decision-first research workspace",
  createdAt: "2026-04-09T00:00:00.000Z",
  updatedAt: "2026-04-09T00:00:00.000Z"
};

const latestRun: RunRecord = {
  run: {
    id: "run-12",
    projectId: "project-1",
    title: "시장 진입 판단",
    mode: "standard",
    status: "decided",
    clarificationQuestions: [],
    input: {
      naturalLanguage: "시장 진입 판단",
      pastedContent: "",
      urls: []
    },
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z"
  },
  watchContext: null,
  projectOrigin: null,
  normalizedInput: null,
  expansion: null,
  kbContext: null,
  decision: {
    value: "go",
    why: "고우선 근거가 충분하다.",
    confidence: "medium",
    blockingUnknowns: ["retention curve validation"],
    nextActions: ["pilot launch"]
  },
  prdSeed: null,
  artifacts: [],
  claims: [],
  citations: [],
  contradictions: [],
  evidenceSummary: null,
  advisory: null
};

const diagnosticRun: RunRecord = {
  ...latestRun,
  evidenceSummary: {
    shouldRemainUnclear: false,
    reasons: [],
    highestPrioritySeen: "official",
    decisiveEvidenceScore: 0.82,
    falseConvergenceRisk: false,
    convergenceRiskReasons: ["support_only_evidence"],
    counterevidenceChecked: true,
    supportOnlyEvidence: false,
    weakEvidence: false,
    sourcePriorityCounts: {
      official: 1,
      primary_data: 1,
      analysis: 1,
      community: 0
    },
    sourceTierCounts: {
      official: 1,
      primary: 1,
      internal: 0,
      community: 0,
      aggregator: 0,
      unknown: 1
    },
    sourcePriorityDiversity: 3,
    hasOfficialOrPrimaryEvidence: true,
    aggregatorOnlyEvidence: false,
    sourceCoverageWarnings: ["no_official_or_primary_evidence", "single_priority_evidence"],
    claimCount: 3,
    contradictionCount: 0
  }
};

const insights = {
  repeatedProblems: ["차별화가 어렵다"],
  repeatedPatterns: ["짧은 루프가 유지율을 높인다"],
  competitorSignals: ["릴스가 편집 자동화를 밀고 있다"],
  contradictionIds: ["contradiction-1"]
};

const decisionHistory: DecisionHistoryItem[] = [
  {
    runId: "run-10",
    createdAt: "2026-04-08T10:00:00.000Z",
    mode: "quick",
    decision: "unclear",
    confidence: "low",
    why: "근거 부족",
    blockingUnknownCount: 2
  }
];

const relatedRuns = [
  {
    runId: "run-9",
    title: "초기 탐색",
    decision: "no_go" as const,
    why: "근거 부족",
    createdAt: "2026-04-07T10:00:00.000Z"
  }
];

const promotionCandidates = [
  {
    id: "repeated_problem-diff",
    kind: "repeated_problem" as const,
    title: "차별화가 어렵다",
    summary: "반복적으로 등장한 문제",
    sourceRunIds: ["run-9", "run-12"],
    status: "suggested" as const,
    reason: "multiple_runs_high_priority_without_conflict"
  }
];

const decisionHistorySummary = [
  {
    runId: "run-10",
    title: "초기 판단",
    decision: "unclear" as const,
    createdAt: "2026-04-08T10:00:00.000Z"
  }
];

const recentContradictions = [
  {
    runId: "run-11",
    contradictionId: "contradiction-1",
    status: "flagged" as const,
    resolution: "unresolved" as const
  }
];

const projectInsightSummary = {
  repeatedProblems: "차별화가 어렵다가 반복된다.",
  solutionPatterns: "짧은 루프가 유지율 개선 패턴으로 보인다.",
  competitorSignals: "릴스 편집 자동화 경쟁이 강해지고 있다.",
  conflicts: "contradiction-1 unresolved"
};

describe("cli bundle", () => {
  it("builds bundle with required sections and metadata", () => {
    const bundle = buildCliBundle({
      project,
      latestRun,
      insights,
      decisionHistory,
      relatedRuns,
      promotionCandidates,
      decisionHistorySummary,
      recentContradictions,
      projectInsightSummary,
      bridgeConfig: {
        provider: "codex",
        mode: "prompt_only"
      },
      now: "2026-04-09T12:00:00.000Z"
    });

    expect(bundle.project).toEqual({
      id: "project-1",
      name: "Decision Engine",
      description: "Decision-first research workspace"
    });
    expect(bundle.latestRun).toEqual({
      id: "run-12",
      decision: "go",
      confidence: "medium",
      why: "고우선 근거가 충분하다.",
      blockingUnknowns: ["retention curve validation"]
    });
    expect(bundle.insights.repeatedProblems).toEqual(["차별화가 어렵다"]);
    expect(bundle.evidenceDiagnostics).toBeNull();
    expect(bundle.decisionHistory).toHaveLength(1);
    expect(bundle.kb.promotionCandidates).toHaveLength(1);
    expect(bundle.kb.relatedRuns).toEqual(relatedRuns);
    expect(bundle.kb.decisionHistorySummary).toEqual(decisionHistorySummary);
    expect(bundle.kb.recentContradictions).toEqual(recentContradictions);
    expect(bundle.kb.projectInsightSummary).toEqual(projectInsightSummary);
    expect(bundle.bridge).toEqual({
      provider: "codex",
      mode: "prompt_only",
      generatedAt: "2026-04-09T12:00:00.000Z",
      projectId: "project-1",
      runId: "run-12",
      schemaVersion: "cli-bridge-v1"
    });
  });

  it("renders markdown with key sections", () => {
    const bundle = buildCliBundle({
      project,
      latestRun,
      insights,
      decisionHistory,
      relatedRuns,
      promotionCandidates,
      decisionHistorySummary,
      recentContradictions,
      projectInsightSummary,
      bridgeConfig: {
        provider: "claude",
        mode: "prompt_only"
      },
      now: "2026-04-09T12:00:00.000Z"
    });

    const markdown = renderCliBundleMarkdown(bundle);

    expect(markdown).toContain("# Decision Engine Bundle");
    expect(markdown).toContain("## Latest Run");
    expect(markdown).toContain("## Project Insights");
    expect(markdown).toContain("## Evidence Diagnostics");
    expect(markdown).toContain("## Decision History");
    expect(markdown).toContain("## KB Context");
    expect(markdown).toContain("### Promotion Candidates");
    expect(markdown).toContain("### Related Runs");
    expect(markdown).toContain("### Decision History Summary");
    expect(markdown).toContain("### Recent Contradictions");
    expect(markdown).toContain("### Project Insight Summary");
    expect(markdown).toContain("## Instructions for External CLI");
    expect(markdown).toContain("- provider: claude");
    expect(markdown).toContain("- external_summary");
  });

  it("includes evidence diagnostics in JSON bundles when present", () => {
    const bundle = buildCliBundle({
      project,
      latestRun: diagnosticRun,
      insights,
      decisionHistory,
      relatedRuns,
      promotionCandidates,
      decisionHistorySummary,
      recentContradictions,
      projectInsightSummary,
      bridgeConfig: {
        provider: "codex",
        mode: "prompt_only"
      },
      now: "2026-04-09T12:00:00.000Z"
    });

    expect(bundle.evidenceDiagnostics).toEqual({
      decisiveEvidenceScore: 0.82,
      falseConvergenceRisk: false,
      convergenceRiskReasons: ["support_only_evidence"],
      counterevidenceChecked: true,
      supportOnlyEvidence: false,
      weakEvidence: false,
      sourcePriorityCounts: {
        official: 1,
        primary_data: 1,
        analysis: 1,
        community: 0
      },
      sourceTierCounts: {
        official: 1,
        primary: 1,
        internal: 0,
        community: 0,
        aggregator: 0,
        unknown: 1
      },
      sourcePriorityDiversity: 3,
      hasOfficialOrPrimaryEvidence: true,
      aggregatorOnlyEvidence: false,
      sourceCoverageWarnings: ["no_official_or_primary_evidence", "single_priority_evidence"]
    });
    expect(bundle.project.id).toBe("project-1");
    expect(bundle.latestRun.id).toBe("run-12");
    expect(bundle.insights.conflicts).toEqual(["contradiction-1"]);
    expect(bundle.bridge.schemaVersion).toBe("cli-bridge-v1");
  });

  it("renders concise evidence diagnostics in markdown", () => {
    const bundle = buildCliBundle({
      project,
      latestRun: diagnosticRun,
      insights,
      decisionHistory,
      bridgeConfig: {
        provider: "claude",
        mode: "prompt_only"
      },
      now: "2026-04-09T12:00:00.000Z"
    });

    const markdown = renderCliBundleMarkdown(bundle);

    expect(markdown).toContain("## Evidence Diagnostics");
    expect(markdown).toContain("- Decisiveness: 0.82");
    expect(markdown).toContain("- False convergence risk: false");
    expect(markdown).toContain("- Counterevidence checked: true");
    expect(markdown).toContain("- Weak evidence: false");
    expect(markdown).toContain("- Source priority diversity: 3");
    expect(markdown).toContain("- Official/primary evidence: true");
    expect(markdown).toContain("- Aggregator-only evidence: false");
    expect(markdown).toContain(
      "- Warnings: no_official_or_primary_evidence, single_priority_evidence"
    );
  });

  it("exports without throwing when diagnostics are absent", () => {
    const bundle = buildCliBundle({
      project,
      latestRun,
      insights,
      decisionHistory,
      bridgeConfig: {
        provider: "codex",
        mode: "prompt_only"
      },
      now: "2026-04-09T12:00:00.000Z"
    });

    expect(bundle.evidenceDiagnostics).toBeNull();
    expect(renderCliBundleMarkdown(bundle)).toContain("## Evidence Diagnostics\n- none");
    expect(bundle.bridge.schemaVersion).toBe("cli-bridge-v1");
  });
});
