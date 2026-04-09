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
});
