import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  renderCliBundleMarkdown,
  type CliBridgeBundle
} from "@/lib/bridge/cli-bundle";
import type { CliAdvisoryInput } from "@/lib/bridge/cli-ingest";

type PromptOnlyInvocation = {
  ok: true;
  provider: CliBridgeBundle["bridge"]["provider"];
  mode: "prompt_only";
  prompt: string;
  bundleJson: string;
  bundleMarkdown: string;
};

type NotImplementedInvocation = {
  ok: false;
  provider: CliBridgeBundle["bridge"]["provider"];
  mode: "cli_execute";
  error: "cli_execute is not implemented in cli-bridge-v1";
  bundleJson: string;
  bundleMarkdown: string;
};

export function createPromptOnlyInvocation(
  bundle: CliBridgeBundle
): PromptOnlyInvocation | NotImplementedInvocation {
  const bundleMarkdown = renderCliBundleMarkdown(bundle);
  const bundleJson = JSON.stringify(bundle, null, 2);

  if (bundle.bridge.mode !== "prompt_only") {
    return {
      ok: false,
      provider: bundle.bridge.provider,
      mode: "cli_execute",
      error: "cli_execute is not implemented in cli-bridge-v1",
      bundleJson,
      bundleMarkdown
    };
  }

  return {
    ok: true,
    provider: bundle.bridge.provider,
    mode: "prompt_only",
    prompt: bundleMarkdown,
    bundleJson,
    bundleMarkdown
  };
}

type CliExecuteSuccess = {
  success: true;
  provider: CliBridgeBundle["bridge"]["provider"];
  mode: "cli_execute";
  prompt: string;
  rawOutput: string;
  parsedAdvisory: Required<CliAdvisoryInput>;
  executedAt: string;
  stderr: string;
};

type CliExecuteFailure = {
  success: false;
  provider: CliBridgeBundle["bridge"]["provider"];
  mode: "cli_execute";
  prompt: string;
  rawOutput: string;
  parsedAdvisory: null;
  executedAt: string;
  stderr: string;
  error: string;
};

type SpawnedProcess = Pick<
  ChildProcessWithoutNullStreams,
  "stdout" | "stderr" | "stdin" | "kill" | "on"
>;

function buildAdvisoryPrompt(bundleMarkdown: string): string {
  return [
    bundleMarkdown,
    "",
    "Return JSON only in this exact shape:",
    "{",
    '  "external_summary": "string",',
    '  "suggested_next_actions": ["string"],',
    '  "notes": ["string"]',
    "}",
    "",
    "Do not include markdown fences.",
    "Do not include extra commentary."
  ].join("\n");
}

function getProviderInvocation(
  provider: CliBridgeBundle["bridge"]["provider"],
  prompt: string
): { command: string; args: string[] } {
  if (provider === "codex") {
    return { command: "codex", args: ["exec", prompt] };
  }

  return { command: "claude", args: ["-p", "--bare", prompt] };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export function parseCliAdvisoryOutput(stdout: string): Required<CliAdvisoryInput> {
  const raw = stdout.trim();

  try {
    const parsed = JSON.parse(raw) as CliAdvisoryInput;
    return {
      external_summary:
        typeof parsed.external_summary === "string" ? parsed.external_summary : "",
      suggested_next_actions: normalizeStringArray(parsed.suggested_next_actions),
      notes: normalizeStringArray(parsed.notes)
    };
  } catch {
    return {
      external_summary: "CLI returned non-JSON output; raw output captured in notes.",
      suggested_next_actions: [],
      notes: raw ? [raw] : []
    };
  }
}

export async function executeCliInvocation(
  bundle: CliBridgeBundle,
  options?: {
    timeoutMs?: number;
    now?: string;
    spawnImpl?: (command: string, args: string[]) => SpawnedProcess;
  }
): Promise<CliExecuteSuccess | CliExecuteFailure> {
  const prompt = buildAdvisoryPrompt(renderCliBundleMarkdown(bundle));
  const executedAt = options?.now ?? new Date().toISOString();

  if (bundle.bridge.mode !== "cli_execute") {
    return {
      success: false,
      provider: bundle.bridge.provider,
      mode: "cli_execute",
      prompt,
      rawOutput: "",
      parsedAdvisory: null,
      executedAt,
      stderr: "",
      error: "cli_execute mode is required for executeCliInvocation"
    };
  }

  const spawnImpl =
    options?.spawnImpl ??
    ((command: string, args: string[]) =>
      spawn(command, args, {
        stdio: "pipe"
      }));

  const { command, args } = getProviderInvocation(bundle.bridge.provider, prompt);
  const child = spawnImpl(command, args);
  const timeoutMs = options?.timeoutMs ?? 60_000;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const finalize = (result: CliExecuteSuccess | CliExecuteFailure) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      finalize({
        success: false,
        provider: bundle.bridge.provider,
        mode: "cli_execute",
        prompt,
        rawOutput: stdout.trim(),
        parsedAdvisory: null,
        executedAt,
        stderr: stderr.trim(),
        error: "CLI execution timed out"
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finalize({
        success: false,
        provider: bundle.bridge.provider,
        mode: "cli_execute",
        prompt,
        rawOutput: stdout.trim(),
        parsedAdvisory: null,
        executedAt,
        stderr: stderr.trim(),
        error: error.message
      });
    });

    child.on("close", (code) => {
      if (timedOut) {
        return;
      }

      if (code !== 0) {
        finalize({
          success: false,
          provider: bundle.bridge.provider,
          mode: "cli_execute",
          prompt,
          rawOutput: stdout.trim(),
          parsedAdvisory: null,
          executedAt,
          stderr: stderr.trim(),
          error: `CLI process exited with code ${code}`
        });
        return;
      }

      finalize({
        success: true,
        provider: bundle.bridge.provider,
        mode: "cli_execute",
        prompt,
        rawOutput: stdout.trim(),
        parsedAdvisory: parseCliAdvisoryOutput(stdout),
        executedAt,
        stderr: stderr.trim()
      });
    });

    child.stdin.end();
  });
}
