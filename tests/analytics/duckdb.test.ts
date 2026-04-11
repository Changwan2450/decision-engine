import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let tempRoot: string | null = null;

describe("duckdb analytics", () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    delete process.env.WORKSPACE_ROOT;
  });

  it("queries events.jsonl through DuckDB", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "decision-engine-analytics-"));
    process.env.WORKSPACE_ROOT = tempRoot;
    vi.resetModules();

    const { createProjectRecord, createRunRecord } = await import("@/lib/storage/workspace");
    const { appendRunEvent } = await import("@/lib/bridge/cli-file");
    const { queryEvents } = await import("@/lib/analytics/duckdb");

    const project = await createProjectRecord({
      name: "Decision Engine",
      description: "analytics"
    });
    const run = await createRunRecord(project.project.id, {
      title: "분석 테스트",
      naturalLanguage: "events 확인"
    });

    await appendRunEvent(project.project.id, run.run.id, {
      type: "bundle_exported",
      detail: { provider: "claude" },
      at: "2026-04-10T00:00:00.000Z"
    });
    await appendRunEvent(project.project.id, run.run.id, {
      type: "bundle_exported",
      detail: { provider: "codex" },
      at: "2026-04-10T00:00:01.000Z"
    });

    const rows = await queryEvents("SELECT type, COUNT(*)::BIGINT AS count FROM events GROUP BY type");

    expect(rows).toEqual([
      {
        type: "bundle_exported",
        count: 2
      }
    ]);
  });

  it("queries workspace run json through DuckDB", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "decision-engine-analytics-"));
    process.env.WORKSPACE_ROOT = tempRoot;
    vi.resetModules();

    const { createProjectRecord, createRunRecord, updateRunRecord } = await import("@/lib/storage/workspace");
    const { queryRuns } = await import("@/lib/analytics/duckdb");

    const project = await createProjectRecord({
      name: "Decision Engine",
      description: "analytics"
    });
    const run = await createRunRecord(project.project.id, {
      title: "시장 판단",
      naturalLanguage: "go 여부"
    });

    await updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      run: {
        ...record.run,
        status: "decided",
        updatedAt: "2026-04-10T00:00:00.000Z"
      },
      decision: {
        value: "go",
        why: "근거 충분",
        confidence: "medium",
        blockingUnknowns: [],
        nextActions: ["pilot"]
      }
    }));

    const rows = await queryRuns(
      "SELECT run.id AS run_id, run.status AS status, decision.value AS decision FROM runs"
    );

    expect(rows).toEqual([
      {
        run_id: run.run.id,
        status: "decided",
        decision: "go"
      }
    ]);
  });
});
