import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let tempRoot: string | null = null;

describe("cli file bridge kb reinjection", () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    delete process.env.WORKSPACE_ROOT;
  });

  it("exports bundle with enriched kb block", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "decision-engine-kb-"));
    process.env.WORKSPACE_ROOT = tempRoot;
    vi.resetModules();

    const { createProjectRecord, createRunRecord, updateRunRecord, updateProjectRecord } = await import(
      "@/lib/storage/workspace"
    );
    const { exportRunBundle } = await import("@/lib/bridge/cli-file");

    const project = await createProjectRecord({
      name: "Decision Engine",
      description: "AI-first"
    });

    const firstRun = await createRunRecord(project.project.id, {
      title: "초기 판단",
      naturalLanguage: "시장 진입 여부"
    });
    const secondRun = await createRunRecord(project.project.id, {
      title: "후속 판단",
      naturalLanguage: "시장 진입 여부"
    });

    await updateRunRecord(project.project.id, firstRun.run.id, (record) => ({
      ...record,
      run: {
        ...record.run,
        status: "decided",
        createdAt: "2026-04-08T10:00:00.000Z",
        updatedAt: "2026-04-08T10:00:00.000Z"
      },
      decision: {
        value: "unclear",
        why: "근거 부족",
        confidence: "low",
        blockingUnknowns: ["demand"],
        nextActions: ["interview"]
      }
    }));

    await updateRunRecord(project.project.id, secondRun.run.id, (record) => ({
      ...record,
      run: {
        ...record.run,
        status: "decided",
        createdAt: "2026-04-09T10:00:00.000Z",
        updatedAt: "2026-04-09T10:00:00.000Z"
      },
      decision: {
        value: "go",
        why: "근거 충분",
        confidence: "medium",
        blockingUnknowns: [],
        nextActions: ["pilot"]
      },
      contradictions: [
        {
          id: "contradiction-1",
          claimIds: ["claim-1", "claim-2"],
          status: "flagged",
          resolution: "unresolved"
        }
      ]
    }));

    await updateProjectRecord(project.project.id, (record) => ({
      ...record,
      insights: {
        repeatedProblems: ["차별화가 어렵다"],
        repeatedPatterns: ["짧은 루프가 유지율을 높인다"],
        competitorSignals: ["릴스 편집 자동화가 강하다"],
        contradictionIds: ["contradiction-1"]
      },
      promotionCandidates: [
        {
          id: "pc-1",
          kind: "repeated_problem",
          title: "차별화가 어렵다",
          summary: "반복 문제",
          sourceRunIds: [firstRun.run.id, secondRun.run.id],
          status: "suggested",
          reason: "multiple_runs_high_priority_without_conflict"
        }
      ]
    }));

    const dir = await exportRunBundle(project.project.id, secondRun.run.id);
    const bundle = JSON.parse(await readFile(path.join(dir, "bundle.json"), "utf8")) as {
      kb: {
        decisionHistorySummary: Array<{ runId: string; title: string; decision: string }>;
        recentContradictions: Array<{ runId: string; contradictionId: string; status: string }>;
        projectInsightSummary: Record<string, string>;
      };
    };

    expect(bundle.kb.decisionHistorySummary).toEqual([
      {
        runId: secondRun.run.id,
        title: "후속 판단",
        decision: "go",
        createdAt: "2026-04-09T10:00:00.000Z"
      },
      {
        runId: firstRun.run.id,
        title: "초기 판단",
        decision: "unclear",
        createdAt: "2026-04-08T10:00:00.000Z"
      }
    ]);
    expect(bundle.kb.recentContradictions).toEqual([
      {
        runId: secondRun.run.id,
        contradictionId: "contradiction-1",
        status: "flagged",
        resolution: "unresolved"
      }
    ]);
    expect(bundle.kb.projectInsightSummary).toEqual({
      repeatedProblems: "차별화가 어렵다",
      solutionPatterns: "짧은 루프가 유지율을 높인다",
      competitorSignals: "릴스 편집 자동화가 강하다",
      conflicts: "contradiction-1"
    });
  });
});
