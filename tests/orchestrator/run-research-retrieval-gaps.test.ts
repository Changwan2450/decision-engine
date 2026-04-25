import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildArtifact } from "@/lib/adapters/contract";
import type { ResearchAdapter, ResearchPlan, SourceArtifact } from "@/lib/adapters/types";
import { setQmdClientForTests, setQmdRunnerForTests } from "@/lib/orchestrator/kb-context";
import { runRecordSchema } from "@/lib/storage/schema";

let tempRoot: string | null = null;
let tempVault: string | null = null;

function makeAdapter(
  name: string,
  exec: (plan: ResearchPlan) => Promise<SourceArtifact[]>
): ResearchAdapter {
  return {
    name,
    supports: () => true,
    execute: exec
  };
}

describe("retrieval attempt gaps", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    setQmdClientForTests(null);
    setQmdRunnerForTests(null);
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
    if (tempVault) {
      await rm(tempVault, { recursive: true, force: true });
      tempVault = null;
    }
    delete process.env.WORKSPACE_ROOT;
    delete process.env.OBSIDIAN_VAULT_PATH;
  });

  it("persists sanitized empty adapter result gaps without changing run outcome", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "research-retrieval-gaps-"));
    tempVault = await mkdtemp(path.join(os.tmpdir(), "research-retrieval-gaps-vault-"));
    process.env.WORKSPACE_ROOT = tempRoot;
    process.env.OBSIDIAN_VAULT_PATH = tempVault;
    setQmdClientForTests({
      async operatorNotes() {
        return [];
      },
      async queryNotes() {
        return [];
      }
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { createProjectRecord, createRunRecord, readRunRecord } = await import(
      "@/lib/storage/workspace"
    );
    const { executeResearchRun } = await import("@/lib/orchestrator/run-research");

    const project = await createProjectRecord({
      name: "Retrieval gaps",
      description: "empty adapter telemetry"
    });
    const longUrl = `https://example.com/search?q=${"x".repeat(320)}`;
    const run = await createRunRecord(project.project.id, {
      title: "retrieval gap run",
      naturalLanguage: "목표: 빈 adapter 결과 추적\n대상: research agent\n비교: fallback",
      urls: [longUrl]
    });

    await executeResearchRun(project.project.id, run.run.id, {
      now: "2026-04-25T00:00:00.000Z",
      research: {
        router: () => ({
          primary: "agent-reach",
          fallbacks: ["scrapling"],
          rule: "community/reddit-search-json"
        }),
        registry: {
          "agent-reach": makeAdapter("agent-reach", async () => {
            const rawResponse = {
              stdout: "stdout-secret",
              stderr: "stderr-secret",
              html: "<html>raw</html>",
              json: "{\"raw\":true}"
            };
            expect(rawResponse.stdout).toBe("stdout-secret");
            return [];
          }),
          scrapling: makeAdapter("scrapling", async (plan) => [
            buildArtifact({
              id: "scrapling-0",
              adapter: "scrapling",
              fetcher: "scrapling",
              sourceType: "community",
              url: plan.normalizedInput.urls[0] ?? "",
              title: "fallback evidence",
              snippet: "fallback produced usable evidence",
              content: "fallback produced usable evidence",
              outcome: { status: "success" }
            })
          ])
        }
      }
    });

    const storedRun = await readRunRecord(project.project.id, run.run.id);
    const gaps = storedRun.retrievalAttemptGaps;
    expect(storedRun.run.status).toBe("decided");
    expect(gaps).not.toBeNull();
    expect(gaps?.version).toBe("v0");
    expect(gaps?.emptyResults.length).toBeGreaterThan(0);
    expect(gaps?.summary.emptyResultCount).toBe(gaps?.emptyResults.length);
    expect(gaps?.summary.droppedAttemptCount).toBe(0);

    const emptyResult = gaps?.emptyResults.find((result) =>
      result.url?.startsWith("https://example.com/search")
    );
    expect(emptyResult).toMatchObject({
      adapter: "agent-reach",
      rule: "community/reddit-search-json",
      sourceType: "community",
      isFallback: false,
      reason: "empty_adapter_result",
      timestamp: "2026-04-25T00:00:00.000Z"
    });
    expect(emptyResult?.url).toHaveLength(240);
    expect(gaps?.emptyResults.every((result) => result.reason === "empty_adapter_result")).toBe(
      true
    );

    const serialized = JSON.stringify(gaps);
    expect(serialized).not.toContain("stdout-secret");
    expect(serialized).not.toContain("stderr-secret");
    expect(serialized).not.toContain("<html>raw</html>");
    expect(serialized).not.toContain("{\"raw\":true}");
    expect(warn).toHaveBeenCalledWith(
      "[run-research] empty adapter result",
      expect.stringContaining("\"adapter\":\"agent-reach\"")
    );
  });

  it("parses legacy run records without retrieval attempt gaps as null", () => {
    const parsed = runRecordSchema.parse({
      run: {
        id: "legacy-run",
        projectId: "project-alpha",
        title: "legacy",
        mode: "standard",
        status: "draft",
        clarificationQuestions: [],
        input: {
          naturalLanguage: "legacy input",
          pastedContent: "",
          urls: []
        },
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:00:00.000Z"
      },
      watchContext: null,
      projectOrigin: null,
      normalizedInput: null,
      expansion: null,
      kbContext: null,
      decision: null,
      prdSeed: null,
      artifacts: [],
      claims: [],
      citations: [],
      contradictions: [],
      evidenceSummary: null,
      advisory: null
    });

    expect(parsed.retrievalAttemptGaps).toBeNull();
  });
});
