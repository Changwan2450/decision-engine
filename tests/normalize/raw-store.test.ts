import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { storeRawPayload } from "@/lib/normalize/raw-store";

let tempRoot: string | null = null;

describe("storeRawPayload()", () => {
  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("writes payloads under the run raw directory and returns a workspace-relative path", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "raw-store-"));

    const rawRef = await storeRawPayload({
      rootDir: tempRoot,
      projectId: "project-1",
      runId: "run-1",
      adapter: "scrapling",
      format: "html",
      payload: "<p>Hello</p>"
    });

    expect(rawRef).toMatch(
      /^project-1\/runs\/run-1\/raw\/scrapling\/[a-f0-9]{64}\.html$/
    );

    const saved = await readFile(path.join(tempRoot, rawRef), "utf8");
    expect(saved).toBe("<p>Hello</p>");
  });

  it("uses a deterministic hash-based key for identical payloads", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "raw-store-"));

    const first = await storeRawPayload({
      rootDir: tempRoot,
      projectId: "project-1",
      runId: "run-1",
      adapter: "agent-reach",
      format: "json",
      payload: "{\"title\":\"same\"}"
    });

    const second = await storeRawPayload({
      rootDir: tempRoot,
      projectId: "project-1",
      runId: "run-1",
      adapter: "agent-reach",
      format: "json",
      payload: "{\"title\":\"same\"}"
    });

    expect(second).toBe(first);
  });
});
