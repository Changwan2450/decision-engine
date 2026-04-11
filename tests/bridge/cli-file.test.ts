import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let tempRoot: string | null = null;

describe("cli file bridge", () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    delete process.env.WORKSPACE_ROOT;
  });

  it("writes run-state.json with current run snapshot", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "decision-engine-bridge-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const { createProjectRecord, createRunRecord, updateRunRecord } = await import(
      "@/lib/storage/workspace"
    );
    const { appendRunEvent, writeRunStateSnapshot } = await import("@/lib/bridge/cli-file");

    const project = await createProjectRecord({
      name: "Decision Engine",
      description: "AI-first"
    });
    const run = await createRunRecord(project.project.id, {
      title: "시장 진입 판단",
      naturalLanguage: "시장 진입 여부 판단"
    });

    await updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      decision: {
        value: "go",
        why: "고우선 근거가 충분하다.",
        confidence: "medium",
        blockingUnknowns: ["retention validation"],
        nextActions: ["pilot launch"]
      },
      advisory: {
        externalSummary: "외부 요약",
        suggestedNextActions: ["추가 인터뷰"],
        notes: ["raw output normalized"],
        provider: "codex",
        mode: "cli_execute",
        ingestedAt: "2026-04-10T00:00:00.000Z",
        executedAt: "2026-04-10T00:00:00.000Z",
        success: true,
        schemaVersion: "cli-bridge-v1"
      },
      run: {
        ...record.run,
        status: "decided",
        updatedAt: "2026-04-10T00:00:00.000Z"
      },
      artifacts: []
    }));

    const filePath = await writeRunStateSnapshot(project.project.id, run.run.id);
    const snapshot = JSON.parse(await readFile(filePath, "utf8")) as {
      projectId: string;
      runId: string;
      status: string;
      decision: { value: string; confidence: string } | null;
      artifactCount: number;
      advisoryStatus: string;
    };

    expect(snapshot.projectId).toBe(project.project.id);
    expect(snapshot.runId).toBe(run.run.id);
    expect(snapshot.status).toBe("decided");
    expect(snapshot.decision).toEqual({
      value: "go",
      confidence: "medium"
    });
    expect(snapshot.artifactCount).toBe(0);
    expect(snapshot.advisoryStatus).toBe("available");

    const eventPath = await appendRunEvent(project.project.id, run.run.id, {
      type: "run_state_written",
      detail: {
        status: "decided"
      },
      at: "2026-04-10T00:00:01.000Z"
    });
    const events = (await readFile(eventPath, "utf8")).trim().split("\n");

    expect(events).toHaveLength(2);
    expect(JSON.parse(events[0]).type).toBe("run_state_written");
    expect(JSON.parse(events[1])).toEqual({
      type: "run_state_written",
      detail: {
        status: "decided"
      },
      at: "2026-04-10T00:00:01.000Z"
    });
  });
});
