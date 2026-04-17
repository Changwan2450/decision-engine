import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let tempRoot: string | null = null;

describe("promoteDigestToProject", () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    delete process.env.WORKSPACE_ROOT;
  });

  it("creates a project run from a digest and marks the inbox item promoted", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "watch-promote-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const {
      createProjectRecord,
      createWatchTargetRecord,
      createRunRecord,
      updateRunRecord,
      readRunRecord,
      listInboxItemRecords
    } = await import("@/lib/storage/workspace");
    const { buildWatchDigest } = await import("@/lib/orchestrator/watch-digest");
    const { promoteDigestToProject } = await import("@/lib/orchestrator/watch-inbox");

    const project = await createProjectRecord({
      name: "Promotable",
      description: "promote test"
    });
    const watchTarget = await createWatchTargetRecord(project.project.id, {
      title: "Short-form watch",
      naturalLanguage: "track short-form creator signals",
      urls: ["https://example.com/source"]
    });

    const run = await createRunRecord(project.project.id, {
      title: "tick 1",
      urls: ["https://example.com/source"]
    });
    await updateRunRecord(project.project.id, run.run.id, (record) => ({
      ...record,
      watchContext: { watchTargetId: watchTarget.id, digestId: null },
      artifacts: [
        {
          id: "artifact-1",
          adapter: "scrapling",
          sourceType: "web",
          title: "Signal",
          url: "https://example.com/source",
          canonicalUrl: "https://example.com/source",
          snippet: "Signal",
          content: "Signal body",
          sourcePriority: "analysis",
          metadata: {
            fetcher: "scrapling",
            fetch_status: "success",
            block_reason: "unknown",
            bypass_level: "none",
            login_required: "false"
          }
        }
      ]
    }));

    const digest = await buildWatchDigest(project.project.id, watchTarget.id, {
      sourceRunIds: [run.run.id],
      now: "2026-04-18T00:00:00.000Z"
    });

    const promoted = await promoteDigestToProject(project.project.id, digest.id, {
      now: "2026-04-19T00:00:00.000Z",
      executeRun: async (projectId, runId) => readRunRecord(projectId, runId)
    });

    expect(promoted.run.title).toContain("Short-form watch");
    expect(promoted.run.input.naturalLanguage).toBe(
      "track short-form creator signals"
    );
    expect(promoted.run.input.pastedContent).toContain(digest.summary);
    expect(promoted.watchContext).toBeNull();
    expect(promoted.projectOrigin).toEqual({
      source: "watch_digest",
      watchTargetId: watchTarget.id,
      digestId: digest.id,
      inboxItemId: expect.any(String),
      sourceRunIds: [run.run.id]
    });

    await expect(listInboxItemRecords(project.project.id)).resolves.toMatchObject([
      {
        kind: "digest",
        refId: digest.id,
        status: "promoted",
        promotedRunId: promoted.run.id
      }
    ]);
  });
});
