import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRecordSchema } from "@/lib/storage/schema";

let tempRoot: string | null = null;

describe("workspace storage", () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("persists project and run records under the workspace root", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "research-workspace-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const { bootstrapWorkspace, readProjectRecord, readRunRecord } = await import(
      "@/lib/storage/workspace"
    );
    const { createProject } = await import("@/lib/domain/projects");
    const { createRun } = await import("@/lib/domain/runs");

    const project = createProject({
      id: "project-alpha",
      name: "Alpha",
      description: "시장조사",
      now: "2026-04-09T00:00:00.000Z"
    });

    const run = createRun({
      id: "run-alpha",
      projectId: project.id,
      title: "1차 리서치",
      now: "2026-04-09T00:00:00.000Z"
    });

    await bootstrapWorkspace(project, run);

    await expect(readProjectRecord(project.id)).resolves.toMatchObject({
      project: { id: project.id, name: "Alpha" }
    });
    await expect(readRunRecord(project.id, run.id)).resolves.toMatchObject({
      run: { id: run.id, title: "1차 리서치" }
    });
  });

  it("creates and lists projects with the minimum required fields", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "research-workspace-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const { createProjectRecord, listProjectRecords } = await import(
      "@/lib/storage/workspace"
    );

    const created = await createProjectRecord({
      name: "Shorts",
      description: "숏츠 포맷 조사"
    });

    expect(created.project.name).toBe("Shorts");

    await expect(listProjectRecords()).resolves.toMatchObject([
      {
        project: {
          id: created.project.id,
          name: "Shorts",
          description: "숏츠 포맷 조사"
        }
      }
    ]);
  });

  it("creates runs in standard mode with mixed input support", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "research-workspace-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const { createProjectRecord, createRunRecord, readRunRecord } = await import(
      "@/lib/storage/workspace"
    );

    const createdProject = await createProjectRecord({
      name: "Creator",
      description: "시장조사"
    });

    const createdRun = await createRunRecord(createdProject.project.id, {
      title: "시장 신호 조사",
      naturalLanguage: "숏츠 시장조사 해줘",
      pastedContent: "커뮤니티에서 본 사례 정리",
      urls: ["https://example.com/post"]
    });

    expect(createdRun.run.mode).toBe("standard");
    expect(createdRun.run.input.naturalLanguage).toBe("숏츠 시장조사 해줘");
    expect(createdRun.run.input.pastedContent).toBe("커뮤니티에서 본 사례 정리");
    expect(createdRun.run.input.urls).toEqual(["https://example.com/post"]);

    await expect(readRunRecord(createdProject.project.id, createdRun.run.id)).resolves.toEqual(
      runRecordSchema.parse(createdRun)
    );
  });

  it("creates and reads watch targets under the workspace root", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "research-workspace-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const {
      createProjectRecord,
      createWatchTargetRecord,
      readWatchTargetRecord
    } = await import("@/lib/storage/workspace");

    const createdProject = await createProjectRecord({
      name: "Watcher",
      description: "watch storage"
    });

    const watchTarget = await createWatchTargetRecord(createdProject.project.id, {
      title: "Creator market watch",
      naturalLanguage: "track creator market",
      urls: ["https://example.com/watch"]
    });

    await expect(
      readWatchTargetRecord(createdProject.project.id, watchTarget.id)
    ).resolves.toMatchObject({
      id: watchTarget.id,
      projectId: createdProject.project.id,
      title: "Creator market watch",
      query: {
        naturalLanguage: "track creator market",
        urls: ["https://example.com/watch"]
      },
      status: "draft"
    });
  });

  it("persists digest records under the workspace root", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "research-workspace-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const {
      createProjectRecord,
      saveDigestRecord,
      readDigestRecord
    } = await import("@/lib/storage/workspace");

    const createdProject = await createProjectRecord({
      name: "Digester",
      description: "digest storage"
    });

    const digest = {
      id: "digest-1",
      projectId: createdProject.project.id,
      watchTargetId: "watch-1",
      windowStart: "2026-04-17T00:00:00.000Z",
      windowEnd: "2026-04-18T00:00:00.000Z",
      sourceRunIds: ["run-1"],
      headline: "digest headline",
      summary: "digest summary",
      status: "built" as const,
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z"
    };

    await saveDigestRecord(digest);

    await expect(
      readDigestRecord(createdProject.project.id, digest.id)
    ).resolves.toEqual(digest);
  });

  it("persists inbox item records under the workspace root", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "research-workspace-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const {
      createProjectRecord,
      saveInboxItemRecord,
      readInboxItemRecord
    } = await import("@/lib/storage/workspace");

    const createdProject = await createProjectRecord({
      name: "Inboxer",
      description: "inbox storage"
    });

    const inboxItem = {
      id: "inbox-1",
      projectId: createdProject.project.id,
      kind: "digest" as const,
      refId: "digest-1",
      watchTargetId: "watch-1",
      status: "unread" as const,
      title: "digest ready",
      summary: "digest summary",
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z"
    };

    await saveInboxItemRecord(inboxItem);

    await expect(
      readInboxItemRecord(createdProject.project.id, inboxItem.id)
    ).resolves.toEqual(inboxItem);
  });

  it("updates inbox lifecycle and finds trace links", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "research-workspace-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const {
      createProjectRecord,
      saveInboxItemRecord,
      updateInboxItemStatus,
      createRunRecord,
      updateRunRecord,
      findInboxItemsByRefId,
      findRunsByDigestId,
      findRunsBySourceRunId
    } = await import("@/lib/storage/workspace");

    const createdProject = await createProjectRecord({
      name: "Tracer",
      description: "trace helpers"
    });

    const run = await createRunRecord(createdProject.project.id, {
      title: "promoted run",
      urls: ["https://example.com/source"]
    });
    await updateRunRecord(createdProject.project.id, run.run.id, (record) => ({
      ...record,
      projectOrigin: {
        source: "watch_digest",
        watchTargetId: "watch-1",
        digestId: "digest-1",
        inboxItemId: "inbox-1",
        sourceRunIds: ["run-source-1", "run-source-2"]
      }
    }));

    await saveInboxItemRecord({
      id: "inbox-1",
      projectId: createdProject.project.id,
      kind: "digest",
      refId: "digest-1",
      watchTargetId: "watch-1",
      status: "unread",
      title: "digest ready",
      summary: "digest summary",
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
      promotedRunId: null
    });

    await expect(
      updateInboxItemStatus(createdProject.project.id, "inbox-1", "read")
    ).resolves.toMatchObject({ status: "read" });
    await expect(
      updateInboxItemStatus(createdProject.project.id, "inbox-1", "archived")
    ).resolves.toMatchObject({ status: "archived" });

    await expect(
      findInboxItemsByRefId(createdProject.project.id, "digest-1")
    ).resolves.toMatchObject([{ id: "inbox-1" }]);
    await expect(findRunsByDigestId(createdProject.project.id, "digest-1")).resolves.toMatchObject([
      { run: { id: run.run.id } }
    ]);
    await expect(
      findRunsBySourceRunId(createdProject.project.id, "run-source-1")
    ).resolves.toMatchObject([{ run: { id: run.run.id } }]);
  });
});
