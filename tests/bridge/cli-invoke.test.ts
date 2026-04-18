import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildCliBundle } from "@/lib/bridge/cli-bundle";
import {
  createPromptOnlyInvocation,
  executeCliInvocation
} from "@/lib/bridge/cli-invoke";
import type { Project } from "@/lib/domain/projects";
import type { RunRecord } from "@/lib/storage/schema";

const project: Project = {
  id: "project-1",
  name: "Decision Engine",
  description: "Decision-first research workspace",
  createdAt: "2026-04-09T00:00:00.000Z",
  updatedAt: "2026-04-09T00:00:00.000Z"
};

const latestRun: RunRecord = {
  run: {
    id: "run-12",
    projectId: "project-1",
    title: "시장 진입 판단",
    mode: "standard",
    status: "decided",
    clarificationQuestions: [],
    input: {
      naturalLanguage: "시장 진입 판단",
      pastedContent: "",
      urls: []
    },
    createdAt: "2026-04-09T10:00:00.000Z",
    updatedAt: "2026-04-09T10:00:00.000Z"
  },
  watchContext: null,
  projectOrigin: null,
  normalizedInput: null,
  expansion: null,
  kbContext: null,
  decision: {
    value: "go",
    why: "고우선 근거가 충분하다.",
    confidence: "medium",
    blockingUnknowns: [],
    nextActions: []
  },
  prdSeed: null,
  artifacts: [],
  claims: [],
  citations: [],
  contradictions: [],
  evidenceSummary: null,
  advisory: null
};

function createChildProcessStub() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    kill: (signal?: NodeJS.Signals | number) => boolean;
    killed: boolean;
  };

  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };

  return child;
}

describe("cli invoke", () => {
  it("returns prompt payload for prompt_only mode", () => {
    const bundle = buildCliBundle({
      project,
      latestRun,
      insights: {
        repeatedProblems: [],
        repeatedPatterns: [],
        competitorSignals: [],
        contradictionIds: []
      },
      decisionHistory: [],
      bridgeConfig: {
        provider: "codex",
        mode: "prompt_only"
      },
      now: "2026-04-09T12:00:00.000Z"
    });

    const invocation = createPromptOnlyInvocation(bundle);

    expect(invocation.provider).toBe("codex");
    expect(invocation.mode).toBe("prompt_only");
    expect(invocation.ok).toBe(true);
    if (invocation.ok) {
      expect(invocation.prompt).toContain("# Decision Engine Bundle");
      expect(invocation.bundleJson).toContain("\"schemaVersion\": \"cli-bridge-v1\"");
      expect(invocation.bundleMarkdown).toContain("Return advisory output only");
    }
  });

  it("returns explicit not implemented result for cli_execute mode", () => {
    const bundle = buildCliBundle({
      project,
      latestRun,
      insights: {
        repeatedProblems: [],
        repeatedPatterns: [],
        competitorSignals: [],
        contradictionIds: []
      },
      decisionHistory: [],
      bridgeConfig: {
        provider: "claude",
        mode: "cli_execute"
      },
      now: "2026-04-09T12:00:00.000Z"
    });

    const invocation = createPromptOnlyInvocation(bundle);

    expect(invocation.ok).toBe(false);
    if (!invocation.ok) {
      expect(invocation.error).toBe("cli_execute is not implemented in cli-bridge-v1");
    }
  });

  it("executes cli and parses advisory json", async () => {
    const bundle = buildCliBundle({
      project,
      latestRun,
      insights: {
        repeatedProblems: [],
        repeatedPatterns: [],
        competitorSignals: [],
        contradictionIds: []
      },
      decisionHistory: [],
      bridgeConfig: {
        provider: "codex",
        mode: "cli_execute"
      },
      now: "2026-04-09T12:00:00.000Z"
    });
    const child = createChildProcessStub();

    const resultPromise = executeCliInvocation(bundle, {
      now: "2026-04-09T12:00:01.000Z",
      spawnImpl: () => {
        queueMicrotask(() => {
          child.stdout.write(
            JSON.stringify({
              external_summary: "외부 요약",
              suggested_next_actions: ["파일럿 런칭"],
              notes: ["community check"]
            })
          );
          child.stdout.end();
          child.stderr.end();
          child.emit("close", 0);
        });

        return child as any;
      }
    });

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.provider).toBe("codex");
    expect(result.parsedAdvisory).toEqual({
      external_summary: "외부 요약",
      suggested_next_actions: ["파일럿 런칭"],
      notes: ["community check"]
    });
  });

  it("falls back safely when cli returns non-json output", async () => {
    const bundle = buildCliBundle({
      project,
      latestRun,
      insights: {
        repeatedProblems: [],
        repeatedPatterns: [],
        competitorSignals: [],
        contradictionIds: []
      },
      decisionHistory: [],
      bridgeConfig: {
        provider: "claude",
        mode: "cli_execute"
      },
      now: "2026-04-09T12:00:00.000Z"
    });
    const child = createChildProcessStub();

    const resultPromise = executeCliInvocation(bundle, {
      now: "2026-04-09T12:00:01.000Z",
      spawnImpl: () => {
        queueMicrotask(() => {
          child.stdout.write("plain text advisory output");
          child.stdout.end();
          child.stderr.end();
          child.emit("close", 0);
        });

        return child as any;
      }
    });

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.parsedAdvisory?.external_summary).toBe(
      "CLI returned non-JSON output; raw output captured in notes."
    );
    expect(result.parsedAdvisory?.notes).toContain("plain text advisory output");
  });

  it("returns failure result when command exits non-zero", async () => {
    const bundle = buildCliBundle({
      project,
      latestRun,
      insights: {
        repeatedProblems: [],
        repeatedPatterns: [],
        competitorSignals: [],
        contradictionIds: []
      },
      decisionHistory: [],
      bridgeConfig: {
        provider: "codex",
        mode: "cli_execute"
      },
      now: "2026-04-09T12:00:00.000Z"
    });
    const child = createChildProcessStub();

    const resultPromise = executeCliInvocation(bundle, {
      now: "2026-04-09T12:00:01.000Z",
      spawnImpl: () => {
        queueMicrotask(() => {
          child.stderr.write("binary missing");
          child.stdout.end();
          child.stderr.end();
          child.emit("close", 1);
        });

        return child as any;
      }
    });

    const result = await resultPromise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("exited with code 1");
    }
    expect(result.rawOutput).toBe("");
  });

  it("handles timeout by killing the subprocess", async () => {
    const bundle = buildCliBundle({
      project,
      latestRun,
      insights: {
        repeatedProblems: [],
        repeatedPatterns: [],
        competitorSignals: [],
        contradictionIds: []
      },
      decisionHistory: [],
      bridgeConfig: {
        provider: "claude",
        mode: "cli_execute"
      },
      now: "2026-04-09T12:00:00.000Z"
    });
    const child = createChildProcessStub();

    const result = await executeCliInvocation(bundle, {
      now: "2026-04-09T12:00:01.000Z",
      timeoutMs: 10,
      spawnImpl: () => child as any
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("CLI execution timed out");
    }
    expect(child.killed).toBe(true);
  });
});
