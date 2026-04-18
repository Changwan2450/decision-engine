import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let tempRoot: string | null = null;

describe("triggerWatchTarget", () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    delete process.env.WORKSPACE_ROOT;
  });

  it("creates a run with watchContext and reuses executeResearchRun", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "watch-runtime-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const {
      createProjectRecord,
      createWatchTargetRecord,
      readRunRecord,
      readWatchTargetRecord,
      updateWatchTargetRecord
    } = await import(
      "@/lib/storage/workspace"
    );
    const { triggerWatchTarget } = await import("@/lib/orchestrator/watch-runtime");

    const project = await createProjectRecord({
      name: "Watchable",
      description: "watch test"
    });
    const watchTarget = await createWatchTargetRecord(project.project.id, {
      title: "Short-form trend watch",
      naturalLanguage: "track short-form creator signals",
      urls: ["https://example.com/watch"]
    });
    await updateWatchTargetRecord(project.project.id, watchTarget.id, (record) => ({
      ...record,
      status: "active"
    }));

    const result = await triggerWatchTarget(project.project.id, watchTarget.id, {
      now: "2026-04-17T12:00:00.000Z",
      triggerId: "manual-1",
      executeRun: async (projectId, runId) => readRunRecord(projectId, runId)
    });

    expect(result.run.projectId).toBe(project.project.id);
    expect(result.run.title).toBe("Short-form trend watch");
    expect(result.watchContext).toEqual({
      watchTargetId: watchTarget.id,
      triggerId: "manual-1",
      digestId: null
    });
    expect(result.run.input.naturalLanguage).toBe(
      "track short-form creator signals"
    );
    expect(result.run.input.urls).toEqual(["https://example.com/watch"]);
    await expect(
      readWatchTargetRecord(project.project.id, watchTarget.id)
    ).resolves.toMatchObject({
      lastTriggeredAt: "2026-04-17T12:00:00.000Z",
      updatedAt: "2026-04-17T12:00:00.000Z"
    });
  });
});
