import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let tempRoot: string | null = null;

describe("buildWatchDigest", () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    delete process.env.WORKSPACE_ROOT;
  });

  it("builds a digest from watch run ids and persists built status", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "watch-digest-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const {
      createProjectRecord,
      createWatchTargetRecord,
      createRunRecord,
      updateRunRecord,
      readDigestRecord
    } = await import("@/lib/storage/workspace");
    const { buildWatchDigest } = await import("@/lib/orchestrator/watch-digest");

    const project = await createProjectRecord({
      name: "Digestable",
      description: "digest test"
    });
    const watchTarget = await createWatchTargetRecord(project.project.id, {
      title: "Short-form watch",
      naturalLanguage: "track short-form",
      urls: ["https://example.com/source"]
    });

    const run1 = await createRunRecord(project.project.id, {
      title: "tick 1",
      urls: ["https://example.com/a"]
    });
    await updateRunRecord(project.project.id, run1.run.id, (record) => ({
      ...record,
      watchContext: { watchTargetId: watchTarget.id, triggerId: "t1", digestId: null },
      artifacts: [
        {
          id: "artifact-1",
          adapter: "scrapling",
          sourceType: "web",
          title: "A",
          url: "https://example.com/a",
          canonicalUrl: "https://example.com/a",
          snippet: "A",
          content: "A body",
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

    const run2 = await createRunRecord(project.project.id, {
      title: "tick 2",
      urls: ["https://example.com/b"]
    });
    await updateRunRecord(project.project.id, run2.run.id, (record) => ({
      ...record,
      watchContext: { watchTargetId: watchTarget.id, triggerId: "t2", digestId: null },
      artifacts: [
        {
          id: "artifact-2",
          adapter: "scrapling",
          sourceType: "web",
          title: "B",
          url: "https://example.com/b",
          canonicalUrl: "https://example.com/b",
          snippet: "B",
          content: "B body",
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

    const statuses: string[] = [];
    const digest = await buildWatchDigest(project.project.id, watchTarget.id, {
      sourceRunIds: [run1.run.id, run2.run.id],
      now: "2026-04-18T00:00:00.000Z",
      onStatusChange: (status) => statuses.push(status)
    });

    expect(statuses).toEqual(["pending", "built"]);
    expect(digest.status).toBe("built");
    expect(digest.sourceRunIds).toEqual([run1.run.id, run2.run.id]);
    expect(digest.headline).toContain("2");
    expect(digest.summary).toContain("novel");

    await expect(readDigestRecord(project.project.id, digest.id)).resolves.toEqual(digest);
  });

  it("treats already-digested URLs as non-novel for later digests", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "watch-digest-"));
    process.env.WORKSPACE_ROOT = tempRoot;

    const {
      createProjectRecord,
      createWatchTargetRecord,
      createRunRecord,
      updateRunRecord
    } = await import("@/lib/storage/workspace");
    const { buildWatchDigest } = await import("@/lib/orchestrator/watch-digest");

    const project = await createProjectRecord({
      name: "Digestable",
      description: "digest novelty test"
    });
    const watchTarget = await createWatchTargetRecord(project.project.id, {
      title: "Repeated signal watch",
      urls: ["https://example.com/source"]
    });

    const run1 = await createRunRecord(project.project.id, {
      title: "tick 1",
      urls: ["https://example.com/a"]
    });
    await updateRunRecord(project.project.id, run1.run.id, (record) => ({
      ...record,
      watchContext: { watchTargetId: watchTarget.id, digestId: null },
      artifacts: [
        {
          id: "artifact-1",
          adapter: "scrapling",
          sourceType: "web",
          title: "A",
          url: "https://example.com/a",
          canonicalUrl: "https://example.com/a",
          snippet: "A",
          content: "A body",
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

    await buildWatchDigest(project.project.id, watchTarget.id, {
      sourceRunIds: [run1.run.id],
      now: "2026-04-18T00:00:00.000Z"
    });

    const run2 = await createRunRecord(project.project.id, {
      title: "tick 2",
      urls: ["https://example.com/a"]
    });
    await updateRunRecord(project.project.id, run2.run.id, (record) => ({
      ...record,
      watchContext: { watchTargetId: watchTarget.id, digestId: null },
      artifacts: [
        {
          id: "artifact-2",
          adapter: "scrapling",
          sourceType: "web",
          title: "A again",
          url: "https://example.com/a",
          canonicalUrl: "https://example.com/a",
          snippet: "A",
          content: "A body",
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
      sourceRunIds: [run2.run.id],
      now: "2026-04-19T00:00:00.000Z"
    });

    expect(digest.summary).toContain("0 novel");
  });
});
