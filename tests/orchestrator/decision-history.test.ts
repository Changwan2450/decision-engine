import { describe, expect, it } from "vitest";
import { buildDecisionHistory } from "@/lib/orchestrator/decision-history";
import type { Project } from "@/lib/domain/projects";
import type { RunRecord } from "@/lib/storage/schema";

const project: Project = {
  id: "project-1",
  name: "Decision Engine",
  description: "desc",
  createdAt: "2026-04-09T00:00:00.000Z",
  updatedAt: "2026-04-09T00:00:00.000Z"
};

function makeRunRecord(input: {
  id: string;
  createdAt: string;
  status:
    | "draft"
    | "awaiting_clarification"
    | "collecting"
    | "synthesizing"
    | "decided"
    | "failed";
  decision?: {
    value: "go" | "no_go" | "unclear";
    confidence: "low" | "medium" | "high";
    why: string;
    blockingUnknowns: string[];
  } | null;
}): RunRecord {
  return {
    run: {
      id: input.id,
      projectId: "project-1",
      title: input.id,
      mode: "standard",
      status: input.status,
      clarificationQuestions: [],
      input: {
        naturalLanguage: "",
        pastedContent: "",
        urls: []
      },
      createdAt: input.createdAt,
      updatedAt: input.createdAt
    },
    watchContext: null,
    projectOrigin: null,
    normalizedInput: null,
    expansion: null,
    kbContext: null,
    decision: input.decision
      ? {
          value: input.decision.value,
          confidence: input.decision.confidence,
          why: input.decision.why,
          blockingUnknowns: input.decision.blockingUnknowns,
          nextActions: []
        }
      : null,
    prdSeed: null,
    artifacts: [],
    claims: [],
    citations: [],
    contradictions: [],
    evidenceSummary: null,
    advisory: null
  };
}

describe("buildDecisionHistory", () => {
  it("includes only decided runs with decisions", () => {
    const history = buildDecisionHistory(project, [
      makeRunRecord({
        id: "run-1",
        createdAt: "2026-04-09T00:00:00.000Z",
        status: "decided",
        decision: {
          value: "go",
          confidence: "high",
          why: "enough evidence",
          blockingUnknowns: []
        }
      }),
      makeRunRecord({
        id: "run-2",
        createdAt: "2026-04-10T00:00:00.000Z",
        status: "collecting",
        decision: null
      }),
      makeRunRecord({
        id: "run-3",
        createdAt: "2026-04-11T00:00:00.000Z",
        status: "decided",
        decision: null
      })
    ]);

    expect(history).toHaveLength(1);
    expect(history[0].runId).toBe("run-1");
  });

  it("sorts ascending and computes blockingUnknownCount", () => {
    const history = buildDecisionHistory(project, [
      makeRunRecord({
        id: "run-2",
        createdAt: "2026-04-11T00:00:00.000Z",
        status: "decided",
        decision: {
          value: "unclear",
          confidence: "low",
          why: "conflict",
          blockingUnknowns: ["a", "b"]
        }
      }),
      makeRunRecord({
        id: "run-1",
        createdAt: "2026-04-09T00:00:00.000Z",
        status: "decided",
        decision: {
          value: "go",
          confidence: "medium",
          why: "signal",
          blockingUnknowns: ["a"]
        }
      })
    ]);

    expect(history.map((item) => item.runId)).toEqual(["run-1", "run-2"]);
    expect(history.map((item) => item.blockingUnknownCount)).toEqual([1, 2]);
  });
});
