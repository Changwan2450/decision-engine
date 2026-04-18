import { describe, expect, it } from "vitest";
import type { RunRecord } from "@/lib/storage/schema";
import { derivePromotionCandidates } from "@/lib/orchestrator/insights";

function makeRunRecord(input: {
  runId: string;
  repeatedProblem?: string;
  repeatedPattern?: string;
  competitorSignal?: string;
  highestPrioritySeen: "official" | "primary_data" | "analysis" | "community";
  contradictionCount?: number;
}): RunRecord {
  return {
    run: {
      id: input.runId,
      projectId: "project-1",
      title: "run",
      mode: "standard",
      status: "decided",
      clarificationQuestions: [],
      input: {
        naturalLanguage: "",
        pastedContent: "",
        urls: []
      },
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z"
    },
    watchContext: null,
    projectOrigin: null,
    normalizedInput: {
      title: "run",
      naturalLanguage: "",
      pastedContent: "",
      urls: []
    },
    expansion: null,
    kbContext: null,
    decision: {
      value: "go",
      why: "근거 충분",
      confidence: "high",
      blockingUnknowns: [],
      nextActions: []
    },
    prdSeed: {
      targetUser: "creator",
      problem: "problem",
      solutionHypothesis: "hypothesis",
      featureCandidates: ["feature"],
      risk: ["risk"]
    },
    artifacts: [
      {
        id: `${input.runId}-artifact`,
        adapter: "agent-reach",
        sourceType: "web",
        title: "artifact",
        url: `https://example.com/${input.runId}`,
        snippet: "",
        content: "",
        sourcePriority: input.highestPrioritySeen,
        metadata: {
          repeated_problem: input.repeatedProblem ?? "",
          repeated_pattern: input.repeatedPattern ?? "",
          competitor_signal: input.competitorSignal ?? ""
        }
      }
    ],
    claims: [],
    citations: [],
    contradictions:
      input.contradictionCount && input.contradictionCount > 0
        ? [
            {
              id: `${input.runId}-contradiction`,
              claimIds: ["claim-1", "claim-2"],
              status: "flagged",
              resolution: "unresolved"
            }
          ]
        : [],
    evidenceSummary: {
      shouldRemainUnclear: false,
      reasons: [],
      highestPrioritySeen: input.highestPrioritySeen,
      claimCount: 1,
      contradictionCount: input.contradictionCount ?? 0
    },
    advisory: null
  };
}

describe("promotion candidates", () => {
  it("suggests promotion only for repeated non-conflicting high-priority signals", () => {
    const runRecords = [
      makeRunRecord({
        runId: "run-1",
        repeatedProblem: "차별화가 어렵다",
        highestPrioritySeen: "official"
      }),
      makeRunRecord({
        runId: "run-2",
        repeatedProblem: "차별화가 어렵다",
        highestPrioritySeen: "primary_data"
      }),
      makeRunRecord({
        runId: "run-3",
        repeatedPattern: "자동 편집 루프",
        highestPrioritySeen: "analysis",
        contradictionCount: 1
      })
    ];

    const candidates = derivePromotionCandidates(runRecords);

    expect(candidates).toEqual([
      {
        id: "repeated_problem-차별화가-어렵다",
        kind: "repeated_problem",
        title: "차별화가 어렵다",
        summary: "2개 런에서 반복됐고 충돌 없이 고우선 출처 근거가 있다.",
        sourceRunIds: ["run-1", "run-2"],
        status: "suggested",
        reason: "multiple_runs_high_priority_without_conflict"
      }
    ]);
  });
});
