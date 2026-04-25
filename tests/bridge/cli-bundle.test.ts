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
  retrievalAttemptGaps: null,
  evidenceSummary: null,
  runtimeProvenance: null,
  advisory: null
};

const diagnosticRun: RunRecord = {
  ...latestRun,
  runtimeProvenance: {
    gitHead: "e9aa8ce",
    nodeVersion: "v22.22.0",
    processStartTime: "2026-04-25T06:00:00.000Z",
    entrypoint: "/repo/lib/mcp/server.ts"
  },
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

const longSnippet = `${"usable evidence ".repeat(30)}SECRET_FULL_CONTENT_MARKER`;
const longClaim = `${"claim evidence ".repeat(30)}SECRET_CLAIM_TAIL`;
const longGapUrl = `https://example.com/search?q=${"agent-research ".repeat(30)}SECRET_GAP_TAIL`;

const evidenceReplayRun: RunRecord = {
  ...diagnosticRun,
  artifacts: [
    {
      id: "artifact-blocked",
      adapter: "scrapling",
      sourceType: "web",
      title: "Blocked Aggregator Source",
      url: "https://s.jina.ai/?q=blocked",
      snippet: longSnippet,
      content: "RAW_HTML_SHOULD_NOT_EXPORT",
      sourcePriority: "analysis",
      sourceTier: "aggregator",
      retrievedAt: "2026-04-25T06:01:00.000Z",
      confidence: 0,
      rawRef: "project/run/raw/secret.json",
      metadata: {
        fetch_status: "blocked",
        block_reason: "login",
        bypass_level: "headers",
        login_required: "true",
        source_label: "web/blocked",
        rate_limit_bucket: "scrapling/stealth",
        error: "AUTH_ERROR_SHOULD_NOT_EXPORT"
      }
    },
    {
      id: "artifact-official",
      adapter: "agent-reach",
      sourceType: "web",
      title: "Official Evidence",
      url: "https://example.com/official",
      snippet: "official source summary",
      content: "OFFICIAL_FULL_CONTENT_SHOULD_NOT_EXPORT",
      sourcePriority: "official",
      sourceTier: "official",
      retrievedAt: "2026-04-25T06:02:00.000Z",
      publishedAt: "2026-04-20T06:02:00.000Z",
      confidence: 0.9,
      rawRef: "project/run/raw/official.json",
      metadata: {
        fetch_status: "success",
        block_reason: "unknown",
        bypass_level: "none",
        source_label: "web/success",
        error: "SUCCESS_ERROR_FIELD_SHOULD_NOT_EXPORT"
      }
    },
    {
      id: "artifact-timeout",
      adapter: "agent-reach",
      sourceType: "web",
      title: "Timeout Source",
      url: "https://example.com/timeout",
      snippet: "timeout source summary",
      content: "TIMEOUT_FULL_CONTENT_SHOULD_NOT_EXPORT",
      sourcePriority: "community",
      sourceTier: "community",
      retrievedAt: "2026-04-25T06:03:00.000Z",
      confidence: 0.1,
      rawRef: "project/run/raw/timeout.json",
      metadata: {
        fetch_status: "timeout",
        block_reason: "unknown",
        bypass_level: "none",
        source_label: "web/timeout",
        error: "TIMEOUT_ERROR_SHOULD_NOT_EXPORT"
      }
    },
    {
      id: "artifact-error",
      adapter: "scrapling",
      sourceType: "web",
      title: "Error Source",
      url: "https://example.com/error",
      snippet: "error source summary",
      content: "ERROR_FULL_CONTENT_SHOULD_NOT_EXPORT",
      sourcePriority: "analysis",
      sourceTier: "unknown",
      retrievedAt: "2026-04-25T06:04:00.000Z",
      confidence: 0.1,
      rawRef: "project/run/raw/error.json",
      metadata: {
        fetch_status: "error",
        block_reason: "unknown",
        bypass_level: "headers",
        source_label: "web/error",
        error: "ERROR_FIELD_SHOULD_NOT_EXPORT"
      }
    }
  ],
  claims: [
    {
      id: "claim-internal",
      artifactId: "artifact-blocked",
      text: "internal prior claim",
      topicKey: "evidence-layer",
      stance: "support",
      citationIds: ["citation-blocked"],
      sourceTier: "internal",
      trustTier: "high",
      provenance: {
        sourcePriority: "analysis",
        sourceTier: "internal",
        trustTier: "high",
        citationCount: 1,
        artifactTitle: "Blocked Aggregator Source",
        artifactUrl: "https://s.jina.ai/?q=blocked"
      }
    },
    {
      id: "claim-official",
      artifactId: "artifact-official",
      text: longClaim,
      topicKey: "evidence-layer",
      stance: "neutral",
      citationIds: ["citation-official"],
      sourceTier: "official",
      trustTier: "high",
      observedAt: "2026-04-20T06:02:00.000Z",
      provenance: {
        sourcePriority: "official",
        sourceTier: "official",
        trustTier: "high",
        citationCount: 1,
        observedAt: "2026-04-20T06:02:00.000Z",
        artifactTitle: "Official Evidence",
        artifactUrl: "https://example.com/official"
      }
    }
  ],
  citations: [
    {
      id: "citation-blocked",
      artifactId: "artifact-blocked",
      title: "Blocked Aggregator Source",
      url: "https://s.jina.ai/?q=blocked",
      priority: "analysis",
      sourceTier: "aggregator",
      trustTier: "low",
      retrievedAt: "2026-04-25T06:01:00.000Z"
    },
    {
      id: "citation-official",
      artifactId: "artifact-official",
      title: "Official Evidence",
      url: "https://example.com/official",
      priority: "official",
      sourceTier: "official",
      trustTier: "high",
      retrievedAt: "2026-04-25T06:02:00.000Z",
      publishedAt: "2026-04-20T06:02:00.000Z"
    }
  ],
  contradictions: [
    {
      id: "contradiction-7",
      claimIds: ["claim-internal", "claim-official"],
      status: "flagged",
      resolution: "unresolved",
      kind: "internal_vs_official",
      tierA: "internal",
      tierB: "official"
    }
  ],
  evidenceSummary: {
    ...diagnosticRun.evidenceSummary!,
    falseConvergenceRisk: true,
    convergenceRiskReasons: ["support_only_evidence"],
    counterevidenceChecked: false,
    weakEvidence: true,
    hasOfficialOrPrimaryEvidence: false,
    sourceCoverageWarnings: ["no_official_or_primary_evidence"]
  }
};

const retrievalAttemptGapRun: RunRecord = {
  ...diagnosticRun,
  retrievalAttemptGaps: {
    version: "v0",
    emptyResults: [
      {
        adapter: "community-search-json",
        url: longGapUrl,
        rule: "community/reddit-search-json",
        sourceType: "community",
        isFallback: false,
        reason: "empty_adapter_result",
        timestamp: "2026-04-25T12:00:00.000Z",
        rawResponse: "RAW_RESPONSE_SHOULD_NOT_EXPORT",
        stdout: "STDOUT_SHOULD_NOT_EXPORT",
        stderr: "STDERR_SHOULD_NOT_EXPORT",
        html: "<html>RAW_HTML_SHOULD_NOT_EXPORT</html>",
        json: "{\"raw\":\"RAW_JSON_SHOULD_NOT_EXPORT\"}",
        metadata: {
          error: "METADATA_ERROR_SHOULD_NOT_EXPORT"
        }
      } as unknown as NonNullable<RunRecord["retrievalAttemptGaps"]>["emptyResults"][number]
    ],
    droppedAttempts: [
      {
        reason: "budget_skipped",
        count: 2,
        adapter: "agent-reach",
        sourceType: "web"
      }
    ],
    summary: {
      emptyResultCount: 1,
      droppedAttemptCount: 2
    }
  }
};

const repairBlockedRun: RunRecord = {
  ...diagnosticRun,
  artifacts: [
    {
      id: "artifact-repair-discovery",
      adapter: "scrapling",
      sourceType: "web",
      title: "Repair Discovery",
      url: "https://s.jina.ai/?q=source+coverage+repair",
      snippet: "repair discovery summary",
      content: "REPAIR_DISCOVERY_FULL_CONTENT_SHOULD_NOT_EXPORT",
      sourcePriority: "analysis",
      sourceTier: "aggregator",
      retrievedAt: "2026-04-25T07:00:00.000Z",
      confidence: 0.1,
      rawRef: "project/run/raw/repair-discovery.json",
      metadata: {
        repair_pass: "source_coverage_v1",
        repair_stage: "discovery",
        repair_reason: "no_official_or_primary_evidence",
        fetch_status: "blocked",
        block_reason: "login",
        error: "REPAIR_DISCOVERY_ERROR_SHOULD_NOT_EXPORT"
      }
    }
  ],
  evidenceSummary: {
    ...diagnosticRun.evidenceSummary!,
    hasOfficialOrPrimaryEvidence: false,
    sourceCoverageWarnings: ["no_official_or_primary_evidence"]
  }
};

const repairNoImprovementRun: RunRecord = {
  ...diagnosticRun,
  artifacts: [
    {
      id: "artifact-repair-discovery",
      adapter: "scrapling",
      sourceType: "web",
      title: "Repair Discovery",
      url: "https://s.jina.ai/?q=source+coverage+repair",
      snippet: "repair discovery summary",
      content: "REPAIR_DISCOVERY_FULL_CONTENT_SHOULD_NOT_EXPORT",
      sourcePriority: "analysis",
      sourceTier: "aggregator",
      retrievedAt: "2026-04-25T07:00:00.000Z",
      confidence: 0.1,
      rawRef: "project/run/raw/repair-discovery.json",
      metadata: {
        repair_pass: "source_coverage_v1",
        repair_stage: "discovery",
        repair_reason: "no_official_or_primary_evidence",
        fetch_status: "blocked",
        block_reason: "login"
      }
    },
    {
      id: "artifact-repair-fallback",
      adapter: "community-search-json",
      sourceType: "community",
      title: "Fallback Discovery",
      url: "https://news.ycombinator.com/item?id=1",
      snippet: "fallback discovery summary",
      content: "FALLBACK_FULL_CONTENT_SHOULD_NOT_EXPORT",
      sourcePriority: "community",
      sourceTier: "community",
      retrievedAt: "2026-04-25T07:01:00.000Z",
      confidence: 0.1,
      rawRef: "project/run/raw/repair-fallback.json",
      metadata: {
        repair_pass: "source_coverage_v1",
        repair_stage: "discovery_fallback",
        repair_reason: "no_official_or_primary_evidence",
        repair_candidate_count: "2"
      }
    },
    {
      id: "artifact-repair-evidence",
      adapter: "scrapling",
      sourceType: "web",
      title: "Repair Evidence",
      url: "https://platform.openai.com/docs/guides/research",
      snippet: "repair evidence summary",
      content: "REPAIR_EVIDENCE_FULL_CONTENT_SHOULD_NOT_EXPORT",
      sourcePriority: "official",
      sourceTier: "official",
      retrievedAt: "2026-04-25T07:02:00.000Z",
      confidence: 0.6,
      rawRef: "project/run/raw/repair-evidence.json",
      metadata: {
        repair_pass: "source_coverage_v1",
        repair_stage: "evidence",
        repair_reason: "no_official_or_primary_evidence",
        repair_discovery_artifact_id: "artifact-repair-fallback",
        repair_follow_rank: "0",
        repair_source_host_class: "official",
        error: "REPAIR_EVIDENCE_ERROR_SHOULD_NOT_EXPORT"
      }
    }
  ],
  evidenceSummary: {
    ...diagnosticRun.evidenceSummary!,
    hasOfficialOrPrimaryEvidence: false,
    sourceCoverageWarnings: ["no_official_or_primary_evidence"]
  }
};

const repairFallbackUnknownCountRun: RunRecord = {
  ...diagnosticRun,
  artifacts: [
    {
      id: "artifact-repair-fallback-unknown",
      adapter: "community-search-json",
      sourceType: "community",
      title: "Fallback Discovery",
      url: "https://news.ycombinator.com/item?id=2",
      snippet: "fallback discovery summary",
      content: "FALLBACK_UNKNOWN_FULL_CONTENT_SHOULD_NOT_EXPORT",
      sourcePriority: "community",
      sourceTier: "community",
      retrievedAt: "2026-04-25T07:01:00.000Z",
      confidence: 0.1,
      rawRef: "project/run/raw/repair-fallback-unknown.json",
      metadata: {
        repair_pass: "source_coverage_v1",
        repair_stage: "discovery_fallback",
        repair_reason: "no_official_or_primary_evidence"
      }
    }
  ],
  evidenceSummary: {
    ...diagnosticRun.evidenceSummary!,
    hasOfficialOrPrimaryEvidence: false,
    sourceCoverageWarnings: ["no_official_or_primary_evidence"]
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
    expect(bundle.runtimeProvenance).toBeNull();
    expect(bundle.repairAttempts.sourceCoverage.attempted).toBe(false);
    expect(bundle.repairAttempts.sourceCoverage.outcome).toBe("not_attempted");
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
    expect(markdown).toContain("## Evidence Replay");
    expect(markdown).toContain("## Retrieval Attempt Gaps");
    expect(markdown).toContain("## Repair Attempts");
    expect(markdown).toContain("## Runtime Provenance");
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
    expect(bundle.runtimeProvenance).toEqual({
      gitHead: "e9aa8ce",
      nodeVersion: "v22.22.0",
      processStartTime: "2026-04-25T06:00:00.000Z",
      entrypoint: "/repo/lib/mcp/server.ts"
    });
    expect(bundle.bridge.schemaVersion).toBe("cli-bridge-v1");
  });

  it("includes compact evidence replay without raw content or unsafe metadata", () => {
    const bundle = buildCliBundle({
      project,
      latestRun: evidenceReplayRun,
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

    expect(bundle.project.id).toBe("project-1");
    expect(bundle.latestRun.id).toBe("run-12");
    expect(bundle.evidenceDiagnostics?.falseConvergenceRisk).toBe(true);
    expect(bundle.runtimeProvenance?.nodeVersion).toBe("v22.22.0");
    expect(bundle.bridge.schemaVersion).toBe("cli-bridge-v1");
    expect(bundle.evidenceReplay.version).toBe("v0");
    expect(bundle.evidenceReplay.limits).toEqual({
      topArtifacts: 8,
      topClaims: 8,
      topCitations: 8,
      contradictions: 5,
      retrievalFailures: 8
    });
    expect(bundle.evidenceReplay.topArtifacts[0]?.id).toBe("artifact-official");
    expect(bundle.evidenceReplay.topClaims[0]?.id).toBe("claim-official");
    expect(bundle.evidenceReplay.topCitations[0]?.id).toBe("citation-official");
    expect(bundle.evidenceReplay.contradictions).toEqual([
      {
        id: "contradiction-7",
        claimIds: ["claim-internal", "claim-official"],
        status: "flagged",
        resolution: "unresolved",
        kind: "internal_vs_official",
        tierA: "internal",
        tierB: "official"
      }
    ]);
    expect(bundle.evidenceReplay.retrievalFailures.map((failure) => failure.fetchStatus)).toEqual([
      "blocked",
      "timeout",
      "error"
    ]);
    expect(bundle.evidenceReplay.sourceQualitySummary).toMatchObject({
      artifactCount: 4,
      claimCount: 2,
      citationCount: 2,
      contradictionCount: 1,
      retrievalFailureCount: 3,
      hasOfficialOrPrimaryEvidence: false,
      weakEvidence: true,
      falseConvergenceRisk: true
    });
    expect(bundle.evidenceReplay.unresolvedEvidenceGaps).toEqual([
      "no_official_or_primary_evidence",
      "support_only_evidence",
      "counterevidence_not_checked",
      "weak_evidence"
    ]);

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("RAW_HTML_SHOULD_NOT_EXPORT");
    expect(serialized).not.toContain("OFFICIAL_FULL_CONTENT_SHOULD_NOT_EXPORT");
    expect(serialized).not.toContain("project/run/raw");
    expect(serialized).not.toContain("AUTH_ERROR_SHOULD_NOT_EXPORT");
    expect(serialized).not.toContain("ERROR_FIELD_SHOULD_NOT_EXPORT");
    expect(serialized).not.toContain("SECRET_FULL_CONTENT_MARKER");
    expect(serialized).not.toContain("SECRET_CLAIM_TAIL");
    expect(bundle.evidenceReplay.topArtifacts[1]?.snippet.length).toBeLessThanOrEqual(240);
    expect(bundle.evidenceReplay.topClaims[0]?.text.length).toBeLessThanOrEqual(240);
  });

  it("renders concise evidence replay in markdown", () => {
    const bundle = buildCliBundle({
      project,
      latestRun: evidenceReplayRun,
      insights,
      decisionHistory,
      bridgeConfig: {
        provider: "claude",
        mode: "prompt_only"
      },
      now: "2026-04-09T12:00:00.000Z"
    });

    const markdown = renderCliBundleMarkdown(bundle);

    expect(markdown).toContain("## Evidence Replay");
    expect(markdown).toContain("### Top Artifacts");
    expect(markdown).toContain("Official Evidence");
    expect(markdown).toContain("### Top Claims");
    expect(markdown).toContain("artifact-official / Official Evidence");
    expect(markdown).toContain("### Top Citations");
    expect(markdown).toContain("citation-official");
    expect(markdown).toContain("### Retrieval Gaps / Failures");
    expect(markdown).toContain("blocked — Blocked Aggregator Source");
    expect(markdown).toContain("### Unresolved Evidence Gaps");
    expect(markdown).toContain("no_official_or_primary_evidence");
    expect(markdown).not.toContain("RAW_HTML_SHOULD_NOT_EXPORT");
    expect(markdown).not.toContain("AUTH_ERROR_SHOULD_NOT_EXPORT");
  });

  it("renders concise runtime provenance in markdown", () => {
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

    expect(markdown).toContain("## Runtime Provenance");
    expect(markdown).toContain("- Git head: e9aa8ce");
    expect(markdown).toContain("- Node version: v22.22.0");
    expect(markdown).toContain("- Process start time: 2026-04-25T06:00:00.000Z");
    expect(markdown).toContain("- Entrypoint: /repo/lib/mcp/server.ts");
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
    expect(bundle.retrievalAttemptGaps).toBeNull();
    expect(bundle.runtimeProvenance).toBeNull();
    expect(renderCliBundleMarkdown(bundle)).toContain("## Evidence Diagnostics\n- none");
    expect(renderCliBundleMarkdown(bundle)).toContain(
      "## Runtime Provenance\n- not available"
    );
    expect(renderCliBundleMarkdown(bundle)).toContain(
      "## Repair Attempts\n- Source coverage repair attempted: no"
    );
    expect(bundle.bridge.schemaVersion).toBe("cli-bridge-v1");
  });

  it("includes repair attempts with blocked primary discovery in JSON and markdown", () => {
    const bundle = buildCliBundle({
      project,
      latestRun: repairBlockedRun,
      insights,
      decisionHistory,
      bridgeConfig: {
        provider: "codex",
        mode: "prompt_only"
      },
      now: "2026-04-09T12:00:00.000Z"
    });

    expect(bundle.repairAttempts.version).toBe("v0");
    expect(bundle.repairAttempts.sourceCoverage.attempted).toBe(true);
    expect(bundle.repairAttempts.sourceCoverage.reason).toBe("no_official_or_primary_evidence");
    expect(bundle.repairAttempts.sourceCoverage.primaryDiscovery).toEqual({
      attempted: true,
      blocked: true,
      artifactIds: ["artifact-repair-discovery"],
      sourceTiers: ["aggregator"],
      urls: ["https://s.jina.ai/?q=source+coverage+repair"]
    });
    expect(bundle.repairAttempts.sourceCoverage.fallbackDiscovery.attempted).toBe(false);
    expect(bundle.repairAttempts.sourceCoverage.followedEvidence.count).toBe(0);
    expect(bundle.repairAttempts.sourceCoverage.outcome).toBe("blocked_primary");

    const markdown = renderCliBundleMarkdown(bundle);
    expect(markdown).toContain("## Repair Attempts");
    expect(markdown).toContain("- Primary discovery: blocked");
    expect(markdown).toContain("- Outcome: blocked_primary");
    expect(markdown).toContain("- Followed evidence count: 0");
  });

  it("derives followed evidence and no_improvement outcome without exporting unsafe fields", () => {
    const bundle = buildCliBundle({
      project,
      latestRun: repairNoImprovementRun,
      insights,
      decisionHistory,
      bridgeConfig: {
        provider: "codex",
        mode: "prompt_only"
      },
      now: "2026-04-09T12:00:00.000Z"
    });

    expect(bundle.repairAttempts.sourceCoverage.attempted).toBe(true);
    expect(bundle.repairAttempts.sourceCoverage.fallbackDiscovery).toEqual({
      attempted: true,
      candidateUrlCount: 2,
      sourceArtifactIds: ["artifact-repair-fallback"]
    });
    expect(bundle.repairAttempts.sourceCoverage.followedEvidence).toEqual({
      count: 1,
      artifactIds: ["artifact-repair-evidence"],
      sourcePriorities: ["official"],
      sourceTiers: ["official"],
      urls: ["https://platform.openai.com/docs/guides/research"]
    });
    expect(bundle.repairAttempts.sourceCoverage.outcome).toBe("no_improvement");
    expect(bundle.bridge.schemaVersion).toBe("cli-bridge-v1");
    expect(bundle.runtimeProvenance).not.toBeNull();
    expect(bundle.evidenceDiagnostics).not.toBeNull();
    expect(bundle.evidenceReplay).not.toBeNull();
    expect(bundle.retrievalAttemptGaps).toBeNull();

    const markdown = renderCliBundleMarkdown(bundle);
    expect(markdown).toContain("## Repair Attempts");
    expect(markdown).toContain("- Fallback discovery: visible");
    expect(markdown).toContain("- Followed evidence count: 1");
    expect(markdown).toContain("- Outcome: no_improvement");
    expect(markdown).toContain("artifact-repair-evidence");

    const serialized = JSON.stringify(bundle);
    const combined = `${serialized}\n${markdown}`;
    expect(combined).not.toContain("REPAIR_DISCOVERY_FULL_CONTENT_SHOULD_NOT_EXPORT");
    expect(combined).not.toContain("FALLBACK_FULL_CONTENT_SHOULD_NOT_EXPORT");
    expect(combined).not.toContain("REPAIR_EVIDENCE_FULL_CONTENT_SHOULD_NOT_EXPORT");
    expect(combined).not.toContain("project/run/raw");
    expect(combined).not.toContain("REPAIR_DISCOVERY_ERROR_SHOULD_NOT_EXPORT");
    expect(combined).not.toContain("REPAIR_EVIDENCE_ERROR_SHOULD_NOT_EXPORT");
  });

  it("does not invent fallback candidate counts when persisted metadata is unavailable", () => {
    const bundle = buildCliBundle({
      project,
      latestRun: repairFallbackUnknownCountRun,
      insights,
      decisionHistory,
      bridgeConfig: {
        provider: "codex",
        mode: "prompt_only"
      },
      now: "2026-04-09T12:00:00.000Z"
    });

    expect(bundle.repairAttempts.sourceCoverage.fallbackDiscovery.attempted).toBe(true);
    expect(bundle.repairAttempts.sourceCoverage.fallbackDiscovery.candidateUrlCount).toBeUndefined();
    expect(bundle.repairAttempts.sourceCoverage.fallbackDiscovery.note).toBe(
      "fallback candidate count unavailable from persisted repair metadata"
    );
    expect(bundle.repairAttempts.sourceCoverage.outcome).toBe("no_candidates");
  });

  it("includes sanitized retrieval attempt gaps in JSON and markdown", () => {
    const bundle = buildCliBundle({
      project,
      latestRun: retrievalAttemptGapRun,
      insights,
      decisionHistory,
      bridgeConfig: {
        provider: "codex",
        mode: "prompt_only"
      },
      now: "2026-04-09T12:00:00.000Z"
    });

    expect(bundle.bridge.schemaVersion).toBe("cli-bridge-v1");
    expect(bundle.evidenceDiagnostics).not.toBeNull();
    expect(bundle.runtimeProvenance).not.toBeNull();
    expect(bundle.evidenceReplay.version).toBe("v0");
    expect(bundle.retrievalAttemptGaps?.version).toBe("v0");
    expect(bundle.retrievalAttemptGaps?.summary.emptyResultCount).toBe(1);
    expect(bundle.retrievalAttemptGaps?.summary.droppedAttemptCount).toBe(2);
    expect(bundle.retrievalAttemptGaps?.emptyResults[0]).toMatchObject({
      adapter: "community-search-json",
      reason: "empty_adapter_result",
      isFallback: false,
      sourceType: "community"
    });
    expect(bundle.retrievalAttemptGaps?.emptyResults[0]?.url.length).toBeLessThanOrEqual(240);
    expect(bundle.retrievalAttemptGaps?.emptyResults[0]?.url).not.toContain("SECRET_GAP_TAIL");

    const markdown = renderCliBundleMarkdown(bundle);
    expect(markdown).toContain("## Retrieval Attempt Gaps");
    expect(markdown).toContain("- Empty adapter results: 1");
    expect(markdown).toContain("- Dropped attempts: 2");
    expect(markdown).toContain("### Empty Results");
    expect(markdown).toContain("adapter: community-search-json");
    expect(markdown).toContain("reason: empty_adapter_result");

    const serialized = JSON.stringify(bundle);
    const combined = `${serialized}\n${markdown}`;
    expect(combined).not.toContain("RAW_RESPONSE_SHOULD_NOT_EXPORT");
    expect(combined).not.toContain("STDOUT_SHOULD_NOT_EXPORT");
    expect(combined).not.toContain("STDERR_SHOULD_NOT_EXPORT");
    expect(combined).not.toContain("RAW_HTML_SHOULD_NOT_EXPORT");
    expect(combined).not.toContain("RAW_JSON_SHOULD_NOT_EXPORT");
    expect(combined).not.toContain("METADATA_ERROR_SHOULD_NOT_EXPORT");
  });

  it("exports safely when retrieval attempt gaps are missing or null", () => {
    const runWithoutGaps = { ...diagnosticRun };
    delete (runWithoutGaps as Partial<RunRecord>).retrievalAttemptGaps;

    const missingBundle = buildCliBundle({
      project,
      latestRun: runWithoutGaps,
      insights,
      decisionHistory,
      bridgeConfig: {
        provider: "codex",
        mode: "prompt_only"
      },
      now: "2026-04-09T12:00:00.000Z"
    });
    const nullBundle = buildCliBundle({
      project,
      latestRun: {
        ...diagnosticRun,
        retrievalAttemptGaps: null
      },
      insights,
      decisionHistory,
      bridgeConfig: {
        provider: "codex",
        mode: "prompt_only"
      },
      now: "2026-04-09T12:00:00.000Z"
    });

    expect(missingBundle.retrievalAttemptGaps).toBeNull();
    expect(nullBundle.retrievalAttemptGaps).toBeNull();
    expect(renderCliBundleMarkdown(missingBundle)).toContain(
      "No retrieval attempt gaps recorded."
    );
    expect(renderCliBundleMarkdown(nullBundle)).toContain(
      "No retrieval attempt gaps recorded."
    );
    expect(missingBundle.bridge.schemaVersion).toBe("cli-bridge-v1");
  });
});
