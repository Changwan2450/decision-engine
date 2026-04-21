import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let tempRoot: string | null = null;

describe("watch scheduler", () => {
  afterEach(async () => {
    vi.resetModules();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    delete process.env.WORKSPACE_ROOT;
  });

  it("evaluates due state across paused, no schedule, first run, not-due, and due cases", async () => {
    const { isWatchTargetDue } = await import("@/lib/orchestrator/watch-scheduler");
    const { watchTargetSchema } = await import("@/lib/storage/schema");

    const base = {
      id: "watch-1",
      projectId: "project-1",
      title: "Watch",
      query: { naturalLanguage: "track", urls: [] },
      sourceFilter: {},
      delivery: { digest: true, alert: false, inbox: true },
      tags: [],
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z"
    };

    expect(
      isWatchTargetDue(
        watchTargetSchema.parse({
          ...base,
          status: "paused",
          schedule: { kind: "interval", intervalMs: 60000 },
          lastTriggeredAt: null
        }),
        "2026-04-18T01:00:00.000Z"
      )
    ).toBe(false);

    expect(
      isWatchTargetDue(
        watchTargetSchema.parse({
          ...base,
          status: "active",
          schedule: null,
          lastTriggeredAt: null
        }),
        "2026-04-18T01:00:00.000Z"
      )
    ).toBe(false);

    expect(
      isWatchTargetDue(
        watchTargetSchema.parse({
          ...base,
          status: "active",
          schedule: { kind: "interval", intervalMs: 60000 },
          lastTriggeredAt: null
        }),
        "2026-04-18T01:00:00.000Z"
      )
    ).toBe(true);

    expect(
      isWatchTargetDue(
        watchTargetSchema.parse({
          ...base,
          status: "active",
          schedule: { kind: "interval", intervalMs: 60000 },
          lastTriggeredAt: "2026-04-18T00:59:30.000Z"
        }),
        "2026-04-18T01:00:00.000Z"
      )
    ).toBe(false);

    expect(
      isWatchTargetDue(
        watchTargetSchema.parse({
          ...base,
          status: "active",
          schedule: { kind: "interval", intervalMs: 60000 },
          lastTriggeredAt: "2026-04-18T00:58:00.000Z"
        }),
        "2026-04-18T01:00:00.000Z"
      )
    ).toBe(true);
  });

  it("runs a scheduler tick across mixed due states", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "watch-scheduler-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const { createProjectRecord, createWatchTargetRecord, updateWatchTargetRecord } = await import(
      "@/lib/storage/workspace"
    );
    const { runSchedulerTick } = await import("@/lib/orchestrator/watch-scheduler");

    const project = await createProjectRecord({
      name: "Scheduler",
      description: "scheduler test"
    });

    const dueA = await createWatchTargetRecord(project.project.id, { title: "Due A" });
    const dueB = await createWatchTargetRecord(project.project.id, { title: "Due B" });
    const notDue = await createWatchTargetRecord(project.project.id, { title: "Not Due" });
    const paused = await createWatchTargetRecord(project.project.id, { title: "Paused" });

    await updateWatchTargetRecord(project.project.id, dueA.id, (record) => ({
      ...record,
      status: "active",
      schedule: { kind: "interval", intervalMs: 60000 }
    }));
    await updateWatchTargetRecord(project.project.id, dueB.id, (record) => ({
      ...record,
      status: "active",
      schedule: { kind: "interval", intervalMs: 60000 },
      lastTriggeredAt: "2026-04-18T00:58:00.000Z"
    }));
    await updateWatchTargetRecord(project.project.id, notDue.id, (record) => ({
      ...record,
      status: "active",
      schedule: { kind: "interval", intervalMs: 60000 },
      lastTriggeredAt: "2026-04-18T00:59:45.000Z"
    }));
    await updateWatchTargetRecord(project.project.id, paused.id, (record) => ({
      ...record,
      status: "paused",
      schedule: { kind: "interval", intervalMs: 60000 }
    }));

    const result = await runSchedulerTick({
      now: "2026-04-18T01:00:00.000Z",
      trigger: async (_projectId, watchTargetId) =>
        ({
          run: { id: `run-for-${watchTargetId}` }
        }) as never
    });

    expect(result.triggered).toEqual(
      expect.arrayContaining([
        {
          projectId: project.project.id,
          watchTargetId: dueA.id,
          runId: `run-for-${dueA.id}`
        },
        {
          projectId: project.project.id,
          watchTargetId: dueB.id,
          runId: `run-for-${dueB.id}`
        }
      ])
    );
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        {
          projectId: project.project.id,
          watchTargetId: notDue.id,
          reason: "not_due"
        },
        {
          projectId: project.project.id,
          watchTargetId: paused.id,
          reason: "paused"
        }
      ])
    );
    expect(result.actionable).toEqual([]);
  });

  it("is idempotent for the same now value", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "watch-scheduler-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const { createProjectRecord, createWatchTargetRecord, readWatchTargetRecord, updateWatchTargetRecord } =
      await import("@/lib/storage/workspace");
    const { runSchedulerTick } = await import("@/lib/orchestrator/watch-scheduler");

    const project = await createProjectRecord({
      name: "Idempotent",
      description: "idempotent test"
    });
    const target = await createWatchTargetRecord(project.project.id, { title: "Due" });
    await updateWatchTargetRecord(project.project.id, target.id, (record) => ({
      ...record,
      status: "active",
      schedule: { kind: "interval", intervalMs: 60000 }
    }));

    const trigger = async (projectId: string, watchTargetId: string, deps?: { now?: string }) => {
      const now = deps?.now ?? new Date().toISOString();
      await updateWatchTargetRecord(projectId, watchTargetId, (record) => ({
        ...record,
        lastTriggeredAt: now,
        updatedAt: now
      }));
      return {
        run: { id: `run-for-${watchTargetId}` }
      } as never;
    };

    const first = await runSchedulerTick({
      now: "2026-04-18T01:00:00.000Z",
      trigger
    });
    const second = await runSchedulerTick({
      now: "2026-04-18T01:00:00.000Z",
      trigger
    });

    expect(first.triggered).toHaveLength(1);
    expect(second.triggered).toEqual([]);
    expect(second.skipped).toEqual([
      {
        projectId: project.project.id,
        watchTargetId: target.id,
        reason: "not_due"
      }
    ]);
    expect(second.actionable).toEqual([]);
    await expect(readWatchTargetRecord(project.project.id, target.id)).resolves.toMatchObject({
      lastTriggeredAt: "2026-04-18T01:00:00.000Z"
    });
  });

  it("respects per-project scope", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "watch-scheduler-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const { createProjectRecord, createWatchTargetRecord, updateWatchTargetRecord } = await import(
      "@/lib/storage/workspace"
    );
    const { runSchedulerTick } = await import("@/lib/orchestrator/watch-scheduler");

    const projectA = await createProjectRecord({ name: "A", description: "A" });
    const projectB = await createProjectRecord({ name: "B", description: "B" });
    const targetA = await createWatchTargetRecord(projectA.project.id, { title: "A target" });
    const targetB = await createWatchTargetRecord(projectB.project.id, { title: "B target" });

    await updateWatchTargetRecord(projectA.project.id, targetA.id, (record) => ({
      ...record,
      status: "active",
      schedule: { kind: "interval", intervalMs: 60000 }
    }));
    await updateWatchTargetRecord(projectB.project.id, targetB.id, (record) => ({
      ...record,
      status: "active",
      schedule: { kind: "interval", intervalMs: 60000 }
    }));

    const result = await runSchedulerTick({
      projectId: projectA.project.id,
      now: "2026-04-18T01:00:00.000Z",
      trigger: async (_projectId, watchTargetId) =>
        ({
          run: { id: `run-for-${watchTargetId}` }
        }) as never
    });

    expect(result.triggered).toEqual([
      {
        projectId: projectA.project.id,
        watchTargetId: targetA.id,
        runId: `run-for-${targetA.id}`
      }
    ]);
    expect(result.actionable).toEqual([]);
  });

  it("absorbs individual trigger failures without failing the tick", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "watch-scheduler-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const { createProjectRecord, createWatchTargetRecord, updateWatchTargetRecord } = await import(
      "@/lib/storage/workspace"
    );
    const { runSchedulerTick } = await import("@/lib/orchestrator/watch-scheduler");

    const project = await createProjectRecord({
      name: "Error absorb",
      description: "scheduler error test"
    });
    const good = await createWatchTargetRecord(project.project.id, { title: "Good" });
    const bad = await createWatchTargetRecord(project.project.id, { title: "Bad" });

    for (const target of [good, bad]) {
      await updateWatchTargetRecord(project.project.id, target.id, (record) => ({
        ...record,
        status: "active",
        schedule: { kind: "interval", intervalMs: 60000 }
      }));
    }

    const result = await runSchedulerTick({
      now: "2026-04-18T01:00:00.000Z",
      trigger: async (_projectId, watchTargetId) => {
        if (watchTargetId === bad.id) {
          throw new Error("boom");
        }
        return {
          run: { id: `run-for-${watchTargetId}` }
        } as never;
      }
    });

    expect(result.triggered).toEqual(
      expect.arrayContaining([
        {
          projectId: project.project.id,
          watchTargetId: good.id,
          runId: `run-for-${good.id}`
        }
      ])
    );
    expect(result.skipped).toContainEqual({
      projectId: project.project.id,
      watchTargetId: bad.id,
      reason: "error"
    });
    expect(result.actionable).toEqual([]);
  });

  it("surfaces unread recommended actions with contradiction-first priority", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "watch-scheduler-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const {
      createProjectRecord,
      createWatchTargetRecord,
      saveInboxItemRecord,
      updateWatchTargetRecord
    } = await import("@/lib/storage/workspace");
    const { runSchedulerTick } = await import("@/lib/orchestrator/watch-scheduler");

    const project = await createProjectRecord({
      name: "Actionable scheduler",
      description: "action queue test"
    });
    const contradictionTarget = await createWatchTargetRecord(project.project.id, {
      title: "Contradiction watch"
    });
    const contradictionTargetLow = await createWatchTargetRecord(project.project.id, {
      title: "Older contradiction watch"
    });
    const reviewTarget = await createWatchTargetRecord(project.project.id, {
      title: "Review watch"
    });

    for (const target of [contradictionTarget, contradictionTargetLow, reviewTarget]) {
      await updateWatchTargetRecord(project.project.id, target.id, (record) => ({
        ...record,
        status: "active",
        schedule: { kind: "interval", intervalMs: 60000 }
      }));
    }

    await saveInboxItemRecord({
      id: "digest-review",
      projectId: project.project.id,
      kind: "digest",
      refId: "digest-review-ref",
      watchTargetId: reviewTarget.id,
      status: "unread",
      title: "Review digest",
      summary: "review new evidence",
      signal: {
        focusTopic: "model routing",
        contradictionCount: 0,
        novelUrlCount: 1,
        sourceRunCount: 1,
        nextAction: "review new evidence on model routing",
        delta: {
          previousFocusTopic: null,
          focusShifted: false,
          contradictionDelta: 0,
          novelUrlDelta: 1,
          sourceRunDelta: 1
        }
      },
      recommendedAction: {
        type: "review_focus_topic",
        title: "Review new evidence on model routing",
        focusTopic: "model routing"
      },
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z"
    });
    await saveInboxItemRecord({
      id: "digest-contradiction",
      projectId: project.project.id,
      kind: "digest",
      refId: "digest-contradiction-ref",
      watchTargetId: contradictionTarget.id,
      status: "unread",
      title: "Contradiction digest",
      summary: "investigate contradiction",
      signal: {
        focusTopic: "benchmark quality",
        contradictionCount: 2,
        novelUrlCount: 1,
        sourceRunCount: 1,
        nextAction: "reinvestigate shifting evidence on benchmark quality",
        delta: {
          previousFocusTopic: "latency",
          focusShifted: true,
          contradictionDelta: 2,
          novelUrlDelta: 0,
          sourceRunDelta: 0
        }
      },
      recommendedAction: {
        type: "investigate_contradiction",
        title: "Reinvestigate shifting evidence on benchmark quality",
        focusTopic: "benchmark quality",
        contradictionCount: 2
      },
      createdAt: "2026-04-18T00:01:00.000Z",
      updatedAt: "2026-04-18T00:01:00.000Z"
    });
    await saveInboxItemRecord({
      id: "digest-contradiction-low",
      projectId: project.project.id,
      kind: "digest",
      refId: "digest-contradiction-low-ref",
      watchTargetId: contradictionTargetLow.id,
      status: "unread",
      title: "Older contradiction digest",
      summary: "investigate contradiction",
      signal: {
        focusTopic: "benchmark quality",
        contradictionCount: 1,
        novelUrlCount: 1,
        sourceRunCount: 1,
        nextAction: "investigate conflicting evidence on benchmark quality",
        delta: {
          previousFocusTopic: "benchmark quality",
          focusShifted: false,
          contradictionDelta: 0,
          novelUrlDelta: 0,
          sourceRunDelta: 0
        }
      },
      recommendedAction: {
        type: "investigate_contradiction",
        title: "Investigate conflicting evidence on benchmark quality",
        focusTopic: "benchmark quality",
        contradictionCount: 1
      },
      createdAt: "2026-04-18T00:01:30.000Z",
      updatedAt: "2026-04-18T00:01:30.000Z"
    });
    await saveInboxItemRecord({
      id: "digest-read",
      projectId: project.project.id,
      kind: "digest",
      refId: "digest-read-ref",
      watchTargetId: contradictionTarget.id,
      status: "read",
      title: "Read digest",
      summary: "already handled",
      signal: {
        focusTopic: "benchmark quality",
        contradictionCount: 1,
        novelUrlCount: 1,
        sourceRunCount: 1,
        nextAction: "investigate conflicting evidence on benchmark quality",
        delta: {
          previousFocusTopic: null,
          focusShifted: false,
          contradictionDelta: 0,
          novelUrlDelta: 0,
          sourceRunDelta: 0
        }
      },
      recommendedAction: {
        type: "investigate_contradiction",
        title: "Should not surface"
      },
      createdAt: "2026-04-18T00:02:00.000Z",
      updatedAt: "2026-04-18T00:02:00.000Z"
    });

    const result = await runSchedulerTick({
      projectId: project.project.id,
      now: "2026-04-18T01:00:00.000Z",
      trigger: async (_projectId, watchTargetId) =>
        ({
          run: { id: `run-for-${watchTargetId}` }
        }) as never
    });

    expect(result.actionable).toEqual([
      {
        projectId: project.project.id,
        watchTargetId: contradictionTarget.id,
        inboxItemId: "digest-contradiction",
        refId: "digest-contradiction-ref",
        kind: "digest",
        priority: "high",
        actionType: "investigate_contradiction",
        actionTitle: "Reinvestigate shifting evidence on benchmark quality",
        contradictionDelta: 2,
        focusShifted: true
      },
      {
        projectId: project.project.id,
        watchTargetId: contradictionTargetLow.id,
        inboxItemId: "digest-contradiction-low",
        refId: "digest-contradiction-low-ref",
        kind: "digest",
        priority: "high",
        actionType: "investigate_contradiction",
        actionTitle: "Investigate conflicting evidence on benchmark quality",
        contradictionDelta: 0,
        focusShifted: false
      },
      {
        projectId: project.project.id,
        watchTargetId: reviewTarget.id,
        inboxItemId: "digest-review",
        refId: "digest-review-ref",
        kind: "digest",
        priority: "medium",
        actionType: "review_focus_topic",
        actionTitle: "Review new evidence on model routing",
        contradictionDelta: 0,
        focusShifted: false
      }
    ]);
  });
});
