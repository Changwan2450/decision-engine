import { describe, expect, it } from "vitest";
import { ingestCliAdvisoryResult } from "@/lib/bridge/cli-ingest";
import type { RunRecord } from "@/lib/storage/schema";

const runRecord: RunRecord = {
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
  normalizedInput: null,
  decision: {
    value: "go",
    why: "충분한 근거",
    confidence: "high",
    blockingUnknowns: ["retention"],
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

describe("cli ingest", () => {
  it("attaches advisory fields and preserves internal decision", () => {
    const updated = ingestCliAdvisoryResult(
      runRecord,
      {
        external_summary: "외부 관점 요약",
        suggested_next_actions: ["커뮤니티 인터뷰 추가"],
        notes: ["confidence 재검증"]
      },
      {
        provider: "codex",
        mode: "cli_execute",
        ingestedAt: "2026-04-09T12:00:00.000Z",
        executedAt: "2026-04-09T11:59:59.000Z",
        success: true
      }
    );

    expect(updated.decision).toEqual(runRecord.decision);
    expect(updated.advisory).toEqual({
      externalSummary: "외부 관점 요약",
      suggestedNextActions: ["커뮤니티 인터뷰 추가"],
      notes: ["confidence 재검증"],
      provider: "codex",
      mode: "cli_execute",
      ingestedAt: "2026-04-09T12:00:00.000Z",
      executedAt: "2026-04-09T11:59:59.000Z",
      success: true,
      schemaVersion: "cli-bridge-v1"
    });
  });
});
