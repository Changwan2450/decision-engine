// Scrapling adapter — generic web fetcher with Turnstile / headless bypass.
//
// Responsibility: take URLs from a ResearchPlan, run them through the
// Scrapling Python bridge (injectable executor), and return one
// SourceArtifact per URL. Success OR failure — every URL produces an
// artifact with the full metadata contract so the router (PR 4) and
// DuckDB aggregations (PR 3+) always have consistent shape.
//
// Contract (enforced by lib/adapters/contract.ts):
//   - fetch_status, block_reason, bypass_level, login_required populated
//     on every path (success / partial / blocked / timeout / error).
//   - Never throws out of execute(). Exec exceptions, non-zero exit codes,
//     JSON parse errors, and executor timeouts are absorbed into failure
//     artifacts so the router can fall back deterministically.
//
// Network boundary: the actual Python / CLI invocation is behind the
// `ScraplingExecutor` interface. Tests inject fixtures. Registry wiring
// uses the real Scrapling CLI with `get -> fetch -> stealthy-fetch`
// escalation; the default executor here remains a stub for unit isolation.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type {
  ResearchAdapter,
  ResearchPlan,
  SourceArtifact,
  SourceTarget
} from "@/lib/adapters/types";
import type {
  ArtifactLanguage,
  BlockReason,
  BypassLevel,
  FetchStatus
} from "@/lib/domain/claims";
import {
  buildArtifact,
  truncateErrorMessage,
  type FetchOutcome
} from "@/lib/adapters/contract";
import {
  normalizeToMarkdown,
  type NormalizeFormat
} from "@/lib/normalize/markitdown";
import {
  storeRawPayload,
  type RawPayloadFormat
} from "@/lib/normalize/raw-store";
import { canonicalize, hostnameOf } from "@/lib/adapters/url";

const execFileAsync = promisify(execFile);

const ADAPTER_NAME = "scrapling";
const FETCHER_NAME = "scrapling";

/** Scrapling fetch mode. Wire-level — executor interprets. */
export type ScraplingMode = "stealth" | "dynamic" | "fetch";

/** Raw output from the executor (process/bridge). */
export type ScraplingExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Executor-signalled timeout. Maps to fetch_status=timeout. */
  timedOut?: boolean;
};

/** Injectable executor. Real wire implementation lands later; tests inject fixtures. */
export type ScraplingExecutor = (input: {
  url: string;
  mode: ScraplingMode;
  timeoutMs: number;
}) => Promise<ScraplingExecResult>;

/**
 * Wire format the Scrapling bridge is expected to emit on stdout. Fields
 * are permissive (all optional) so partial/blocked responses can still be
 * classified without losing the metadata contract.
 */
export type ScraplingResponse = {
  status?: string;
  block_reason?: string;
  bypass_level?: string;
  login_required?: boolean;
  title?: string;
  snippet?: string;
  text?: string;
  html?: string;
  final_url?: string;
  language?: string;
  published_at?: string;
  error?: string;
};

type CreateOpts = {
  exec?: ScraplingExecutor;
  mode?: ScraplingMode;
  defaultTimeoutMs?: number;
  now?: () => string;
  normalize?: typeof normalizeToMarkdown;
  storeRaw?: typeof storeRawPayload;
};

export function createScraplingAdapter(deps?: CreateOpts): ResearchAdapter {
  const exec = deps?.exec ?? defaultExecutor;
  const mode: ScraplingMode = deps?.mode ?? "stealth";
  const defaultTimeoutMs = deps?.defaultTimeoutMs ?? 30_000;
  const now = deps?.now ?? (() => new Date().toISOString());
  const normalize = deps?.normalize ?? normalizeToMarkdown;
  const storeRaw = deps?.storeRaw ?? storeRawPayload;

  return {
    name: ADAPTER_NAME,
    supports(plan: ResearchPlan) {
      if (plan.normalizedInput.urls.length === 0) return false;
      return plan.sourceTargets.some((t) => t === "web" || t === "community");
    },
    async execute(plan: ResearchPlan) {
      const urls = plan.normalizedInput.urls;
      const results = await Promise.all(
        urls.map((url, index) =>
          fetchOne({
            url,
            index,
            mode,
            exec,
            timeoutMs: defaultTimeoutMs,
            retrievedAt: now(),
            projectId: plan.projectId,
            runId: plan.runId,
            normalize,
            storeRaw
          })
        )
      );
      return results;
    }
  };
}

async function fetchOne(args: {
  url: string;
  index: number;
  mode: ScraplingMode;
  exec: ScraplingExecutor;
  timeoutMs: number;
  retrievedAt: string;
  projectId: string;
  runId: string;
  normalize: typeof normalizeToMarkdown;
  storeRaw: typeof storeRawPayload;
}): Promise<SourceArtifact> {
  const {
    url,
    index,
    mode,
    exec,
    timeoutMs,
    retrievedAt,
    projectId,
    runId,
    normalize,
    storeRaw
  } = args;
  const canonical = canonicalize(url);
  const sourceType = classifyUrl(url);
  const id = `${ADAPTER_NAME}-${index}`;

  let response: ScraplingResponse | null = null;
  let outcome: FetchOutcome = failedOutcome("error");
  let errorMessage = "";

  try {
    const result = await exec({ url, mode, timeoutMs });

    if (result.timedOut) {
      outcome = failedOutcome("timeout");
      errorMessage = truncateErrorMessage(
        result.stderr || "scrapling executor timed out"
      );
    } else if (result.exitCode !== 0) {
      outcome = failedOutcome("error");
      errorMessage = truncateErrorMessage(
        result.stderr || `scrapling exit ${result.exitCode}`
      );
    } else {
      try {
        response = JSON.parse(result.stdout) as ScraplingResponse;
        outcome = parseOutcome(response);
        if (response.error) {
          errorMessage = truncateErrorMessage(response.error);
        }
      } catch (err) {
        outcome = failedOutcome("error");
        errorMessage = truncateErrorMessage(
          `scrapling parse: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } catch (err) {
    outcome = failedOutcome("error");
    errorMessage = truncateErrorMessage(
      err instanceof Error ? err.message : String(err)
    );
  }

  // Downgrade: status=success but no body text/html is semantically partial.
  if (
    response &&
    outcome.status === "success" &&
    !(response.text?.trim() || response.html?.trim())
  ) {
    outcome = { ...outcome, status: "partial" };
  }

  let content = "";
  let rawRef: string | undefined;

  const rawPayload = pickRawPayload(response);
  if (rawPayload) {
    try {
      rawRef = await storeRaw({
        projectId,
        runId,
        adapter: ADAPTER_NAME,
        format: rawPayload.storeFormat,
        payload: rawPayload.payload
      });
      content = await normalize({
        format: rawPayload.normalizeFormat,
        payload: rawPayload.payload
      });
    } catch (err) {
      outcome = failedOutcome("error");
      errorMessage = truncateErrorMessage(
        err instanceof Error ? err.message : String(err)
      );
      content = "";
      rawRef = undefined;
    }
  }

  const title = (response?.title ?? "").trim();
  const snippetFromWire = (response?.snippet ?? "").trim();
  const snippet = snippetFromWire || defaultSnippet(content);
  const language = coerceLanguage(response?.language);
  const publishedAt = coerceDateIso(response?.published_at);

  return buildArtifact({
    id,
    adapter: ADAPTER_NAME,
    fetcher: FETCHER_NAME,
    sourceType,
    url,
    canonicalUrl: canonical || undefined,
    title,
    snippet,
    content,
    retrievedAt,
    publishedAt,
    language,
    rawRef,
    outcome,
    sourceLabel: `${sourceType}/${outcome.status}`,
    rateLimitBucket: `scrapling/${mode}`,
    extra: errorMessage ? { error: errorMessage } : undefined
  });
}

// ---- outcome parsing ---------------------------------------------------

function parseOutcome(resp: ScraplingResponse): FetchOutcome {
  return {
    status: coerceStatus(resp.status),
    blockReason: coerceBlockReason(resp.block_reason),
    bypassLevel: coerceBypassLevel(resp.bypass_level),
    loginRequired: Boolean(resp.login_required)
  };
}

function failedOutcome(
  status: Extract<FetchStatus, "error" | "timeout" | "blocked">
): FetchOutcome {
  return {
    status,
    blockReason: "unknown",
    bypassLevel: "none",
    loginRequired: false
  };
}

function coerceStatus(s: string | undefined): FetchStatus {
  switch (s) {
    case "success":
    case "partial":
    case "blocked":
    case "timeout":
    case "error":
      return s;
    default:
      return "error";
  }
}

function coerceBlockReason(s: string | undefined): BlockReason {
  switch (s) {
    case "turnstile":
    case "login":
    case "geo":
    case "captcha":
    case "ratelimit":
    case "unknown":
      return s;
    default:
      return "unknown";
  }
}

function coerceBypassLevel(s: string | undefined): BypassLevel {
  switch (s) {
    case "none":
    case "headers":
    case "tls":
    case "turnstile":
    case "headless":
      return s;
    default:
      return "none";
  }
}

function coerceLanguage(s: string | undefined): ArtifactLanguage | undefined {
  switch (s) {
    case "ko":
    case "en":
    case "zh":
    case "ja":
    case "unknown":
      return s;
    default:
      return undefined;
  }
}

function coerceDateIso(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function defaultSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

function pickRawPayload(
  response: ScraplingResponse | null
):
  | {
      payload: string;
      storeFormat: RawPayloadFormat;
      normalizeFormat: NormalizeFormat;
    }
  | null {
  const html = response?.html?.trim();
  if (html) {
    return {
      payload: html,
      storeFormat: "html",
      normalizeFormat: "html"
    };
  }

  const text = response?.text?.trim();
  if (text) {
    return {
      payload: text,
      storeFormat: "txt",
      normalizeFormat: "text"
    };
  }

  return null;
}

// ---- URL classification (semantic tag, not routing) --------------------

const COMMUNITY_HOSTS = [
  "reddit.com",
  "x.com",
  "twitter.com",
  "xiaohongshu.com",
  "dcinside.com",
  "arca.live",
  "clien.net",
  "fmkorea.com",
  "ppomppu.co.kr",
  "ruliweb.com",
  "inven.co.kr",
  "instiz.net",
  "theqoo.net",
  "mlbpark.donga.com"
];

function classifyUrl(url: string): SourceTarget {
  const host = hostnameOf(url);
  if (!host) return "web";
  if (COMMUNITY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return "community";
  }
  return "web";
}

// ---- default executor --------------------------------------------------
//
// Until the Python bridge is wired (PR 4), the default executor signals
// "not configured" by returning a non-zero exit. Adapter absorbs this into
// a failure artifact so no unconfigured runtime ever throws.

const defaultExecutor: ScraplingExecutor = async () => ({
  stdout: "",
  stderr: "scrapling executor not configured (default stub)",
  exitCode: 1
});

type CliRunner = (input: {
  command: string;
  args: string[];
  timeoutMs: number;
}) => Promise<ScraplingExecResult>;

export function createCliExecutor(opts?: {
  command?: string;
  run?: CliRunner;
  tmpRoot?: string;
}): ScraplingExecutor {
  const command = opts?.command ?? "scrapling";
  const run = opts?.run ?? defaultCliRunner;
  const tmpRoot = opts?.tmpRoot ?? os.tmpdir();

  return async (input) => {
    const attempts = buildCliAttempts(input);

    for (const attempt of attempts) {
      const tempDir = await mkdtemp(path.join(tmpRoot, "scrapling-"));
      const outputFile = path.join(tempDir, "page.html");
      try {
        const result = await run({
          command,
          args: [...attempt.args, input.url, outputFile],
          timeoutMs: attempt.timeoutMs
        });

        if (result.timedOut) {
          return result;
        }

        if (result.exitCode === 0) {
          const html = await readFile(outputFile, "utf8").catch(() => "");
          if (html.trim()) {
            return {
              stdout: JSON.stringify({
                status: "success",
                html,
                final_url: input.url,
                bypass_level: attempt.bypassLevel
              }),
              stderr: result.stderr,
              exitCode: 0
            };
          }
        }

        const classified = classifyCliError(result.stderr || result.stdout, attempt.bypassLevel);
        if (classified) {
          return {
            stdout: JSON.stringify({
              status: "blocked",
              block_reason: classified.blockReason,
              bypass_level: classified.bypassLevel,
              login_required: classified.loginRequired,
              error: classified.errorMessage
            }),
            stderr: result.stderr,
            exitCode: 0
          };
        }

        if (!attempt.allowFallback) {
          return result;
        }
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    return {
      stdout: "",
      stderr: "scrapling cli failed without classified result",
      exitCode: 1
    };
  };
}

/**
 * Convenience: build an executor that spawns an external process.
 * Not used by the adapter default — exposed for runtime wiring (PR 4)
 * and for integration tests that want to exercise a real subprocess.
 */
export function createProcessExecutor(opts: {
  command: string;
  args?: (input: { url: string; mode: ScraplingMode; timeoutMs: number }) => string[];
}): ScraplingExecutor {
  return async (input) => {
    const argv = opts.args
      ? opts.args(input)
      : ["--url", input.url, "--mode", input.mode, "--timeout-ms", String(input.timeoutMs)];
    try {
      const result = await execFileAsync(opts.command, argv, {
        timeout: input.timeoutMs,
        maxBuffer: 16 * 1024 * 1024
      });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (error) {
      const err = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        killed?: boolean;
        signal?: string;
      };
      const timedOut = err.killed === true && err.signal === "SIGTERM";
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? err.message,
        exitCode: typeof err.code === "number" ? err.code : 1,
        timedOut
      };
    }
  };
}

function buildCliAttempts(input: {
  url: string;
  mode: ScraplingMode;
  timeoutMs: number;
}): Array<{
  args: string[];
  timeoutMs: number;
  bypassLevel: BypassLevel;
  allowFallback: boolean;
}> {
  if (input.mode === "fetch") {
    return [
      {
        args: ["extract", "get", "--timeout", String(Math.max(1, Math.ceil(input.timeoutMs / 1000)))],
        timeoutMs: input.timeoutMs,
        bypassLevel: "headers",
        allowFallback: false
      }
    ];
  }

  if (input.mode === "dynamic") {
    return [
      {
        args: ["extract", "get", "--timeout", String(Math.max(1, Math.ceil(input.timeoutMs / 1000)))],
        timeoutMs: input.timeoutMs,
        bypassLevel: "headers",
        allowFallback: true
      },
      {
        args: ["extract", "fetch", "--timeout", String(input.timeoutMs), "--disable-resources"],
        timeoutMs: input.timeoutMs,
        bypassLevel: "headless",
        allowFallback: false
      }
    ];
  }

  return [
    {
      args: ["extract", "get", "--timeout", String(Math.max(1, Math.ceil(input.timeoutMs / 1000)))],
      timeoutMs: input.timeoutMs,
      bypassLevel: "headers",
      allowFallback: true
    },
    {
      args: ["extract", "fetch", "--timeout", String(input.timeoutMs), "--disable-resources"],
      timeoutMs: input.timeoutMs,
      bypassLevel: "headless",
      allowFallback: true
    },
    {
      args: [
        "extract",
        "stealthy-fetch",
        "--timeout",
        String(input.timeoutMs),
        "--disable-resources",
        "--solve-cloudflare"
      ],
      timeoutMs: input.timeoutMs,
      bypassLevel: "turnstile",
      allowFallback: false
    }
  ];
}

function classifyCliError(
  message: string,
  bypassLevel: BypassLevel
): {
  blockReason: BlockReason;
  bypassLevel: BypassLevel;
  loginRequired: boolean;
  errorMessage: string;
} | null {
  const lower = message.toLowerCase();
  if (
    lower.includes("cloudflare") ||
    lower.includes("turnstile") ||
    lower.includes("interstitial")
  ) {
    return {
      blockReason: "turnstile",
      bypassLevel,
      loginRequired: false,
      errorMessage: truncateErrorMessage(message)
    };
  }

  if (lower.includes("captcha")) {
    return {
      blockReason: "captcha",
      bypassLevel,
      loginRequired: false,
      errorMessage: truncateErrorMessage(message)
    };
  }

  if (lower.includes("429") || lower.includes("rate limit")) {
    return {
      blockReason: "ratelimit",
      bypassLevel,
      loginRequired: false,
      errorMessage: truncateErrorMessage(message)
    };
  }

  if (
    lower.includes("login") ||
    lower.includes("sign in") ||
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("cookies")
  ) {
    return {
      blockReason: "login",
      bypassLevel,
      loginRequired: true,
      errorMessage: truncateErrorMessage(message)
    };
  }

  return null;
}

const defaultCliRunner: CliRunner = async (input) => {
  try {
    const result = await execFileAsync(input.command, input.args, {
      timeout: input.timeoutMs,
      maxBuffer: 16 * 1024 * 1024
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
      signal?: string;
    };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      exitCode: typeof err.code === "number" ? err.code : 1,
      timedOut: err.killed === true && err.signal === "SIGTERM"
    };
  }
};
