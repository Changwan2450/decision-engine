// Agent-Reach adapter — community / video / github metadata fetcher.
//
// Responsibility: issue a single query-shaped batch call through the
// Agent-Reach Python bridge (injectable executor) and turn each returned
// item into a SourceArtifact with the full metadata contract.
//
// Contract (shared with scrapling via lib/adapters/contract.ts):
//   - fetch_status / block_reason / bypass_level / login_required populated
//     on every path (success / partial / blocked / timeout / error).
//   - Never throws. CLI non-zero exit, stderr bubbles, JSON parse errors,
//     and caller exceptions are absorbed into a single failure artifact so
//     the router (PR 4) can fall back deterministically.
//
// Network boundary: the actual Python / CLI invocation is behind the
// `AgentReachExecutor` interface. Tests inject fixtures. The current
// default executor runs a placeholder python script; it will be replaced
// with the real Agent-Reach invocation in PR 4.

import path from "node:path";
import { execFile } from "node:child_process";
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
  buildFailureArtifact,
  deriveTitleFromUrl,
  truncateErrorMessage,
  type FetchOutcome
} from "@/lib/adapters/contract";
import { normalizeToMarkdown } from "@/lib/normalize/markitdown";
import { storeRawPayload } from "@/lib/normalize/raw-store";
import { canonicalize } from "@/lib/adapters/url";

const execFileAsync = promisify(execFile);

const ADAPTER_NAME = "agent-reach";
const FETCHER_NAME = "agent-reach";

type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
};

export type AgentReachExecutor = (
  command: string,
  args: string[]
) => Promise<ExecResult>;

/** Wire-level shape of items emitted by the Agent-Reach bridge. */
export type AgentReachItem = {
  sourceType?: string;
  title?: string;
  url?: string;
  snippet?: string;
  content?: string;
  publishedAt?: string;
  language?: string;
  status?: string;
  block_reason?: string;
  bypass_level?: string;
  login_required?: boolean;
  metadata?: Record<string, string>;
};

export type AgentReachResponse = {
  items?: AgentReachItem[];
  status?: string;
  error?: string;
};

function defaultExecutor(command: string, args: string[]): Promise<ExecResult> {
  return execFileAsync(command, args).then(
    (result) => ({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0
    }),
    (error: NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
      signal?: string;
    }) => ({
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message,
      exitCode: typeof error.code === "number" ? error.code : 1,
      timedOut: error.killed === true && error.signal === "SIGTERM"
    })
  );
}

function coerceSourceType(value: string | undefined): SourceTarget {
  if (
    value === "web" ||
    value === "community" ||
    value === "video" ||
    value === "github"
  ) {
    return value;
  }
  return "web";
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
      return "success"; // items without explicit status are success by default
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

function buildQuery(plan: ResearchPlan): string {
  const base = [
    plan.title,
    plan.normalizedInput.goal,
    plan.normalizedInput.target,
    plan.normalizedInput.comparisonAxis
  ]
    .filter(Boolean)
    .join(" | ");

  if (!plan.kbContext) {
    return base;
  }

  const sections = [
    base,
    plan.kbContext.queryExpansion.length > 0
      ? `kb_expand: ${plan.kbContext.queryExpansion.join(" ; ")}`
      : "",
    plan.kbContext.duplicateWarnings.length > 0
      ? `avoid_repeat: ${plan.kbContext.duplicateWarnings.join(" ; ")}`
      : "",
    plan.kbContext.freshEvidenceFocus.length > 0
      ? `fresh_focus: ${plan.kbContext.freshEvidenceFocus.join(" ; ")}`
      : ""
  ].filter(Boolean);

  return sections.join(" || ");
}

function itemOutcome(item: AgentReachItem): FetchOutcome {
  return {
    status: coerceStatus(item.status),
    blockReason: coerceBlockReason(item.block_reason),
    bypassLevel: coerceBypassLevel(item.bypass_level),
    loginRequired: Boolean(item.login_required)
  };
}

async function itemToArtifact(
  item: AgentReachItem,
  index: number,
  retrievedAt: string,
  fallbackUrl: string,
  plan: Pick<ResearchPlan, "projectId" | "runId">,
  deps: {
    normalize: typeof normalizeToMarkdown;
    storeRaw: typeof storeRawPayload;
  }
): Promise<SourceArtifact> {
  const url = (item.url && item.url.length > 0 ? item.url : fallbackUrl) || "";
  const canonical = canonicalize(url);
  const outcome = itemOutcome(item);
  const sourceType = coerceSourceType(item.sourceType);
  const title = (item.title ?? "").trim() || deriveTitleFromUrl(url);
  const rawRef = await deps.storeRaw({
    projectId: plan.projectId,
    runId: plan.runId,
    adapter: ADAPTER_NAME,
    format: "json",
    payload: JSON.stringify(item)
  });
  const content = item.content?.trim()
    ? await deps.normalize({
        format: "text",
        payload: item.content
      })
    : "";

  return buildArtifact({
    id: `${ADAPTER_NAME}-${index}`,
    adapter: ADAPTER_NAME,
    fetcher: FETCHER_NAME,
    sourceType,
    url,
    canonicalUrl: canonical || undefined,
    title,
    snippet: item.snippet ?? "",
    content,
    retrievedAt,
    publishedAt: coerceDateIso(item.publishedAt),
    language: coerceLanguage(item.language),
    rawRef,
    outcome,
    sourceLabel: `${sourceType}/${outcome.status}`,
    rateLimitBucket: "agent-reach/default",
    // Preserve any wire-level extras (repeated_problem, retrieval_mode, ...).
    extra: item.metadata
  });
}

export function createAgentReachAdapter(deps?: {
  exec?: AgentReachExecutor;
  now?: () => string;
  normalize?: typeof normalizeToMarkdown;
  storeRaw?: typeof storeRawPayload;
}): ResearchAdapter {
  const exec = deps?.exec ?? defaultExecutor;
  const now = deps?.now ?? (() => new Date().toISOString());
  const normalize = deps?.normalize ?? normalizeToMarkdown;
  const storeRaw = deps?.storeRaw ?? storeRawPayload;

  return {
    name: ADAPTER_NAME,
    supports(plan: ResearchPlan) {
      return plan.sourceTargets.some((target) =>
        ["web", "community", "video", "github"].includes(target)
      );
    },
    async execute(plan: ResearchPlan) {
      const retrievedAt = now();
      const fallbackUrl = plan.normalizedInput.urls[0] ?? "";
      const repoRoot = path.join(process.cwd(), "..", "git clone", "Agent-Reach");
      const query = buildQuery(plan);

      const script = [
        "import json, sys",
        "payload = {'items':[{'sourceType':'web','title':sys.argv[1],'url':(sys.argv[2] if len(sys.argv)>2 else ''),'snippet':'agent-reach placeholder','metadata':{'retrieval_mode':'fresh_evidence'}}]}",
        "print(json.dumps(payload, ensure_ascii=False))"
      ].join("; ");

      let result: ExecResult;
      try {
        result = await exec("python3", [
          "-c",
          script,
          query,
          fallbackUrl,
          repoRoot
        ]);
      } catch (err) {
        return [
          buildAgentReachFailure({
            url: fallbackUrl,
            retrievedAt,
            status: "error",
            errorMessage:
              err instanceof Error ? err.message : String(err)
          })
        ];
      }

      if (result.timedOut) {
        return [
          buildAgentReachFailure({
            url: fallbackUrl,
            retrievedAt,
            status: "timeout",
            errorMessage: result.stderr || "agent-reach executor timed out"
          })
        ];
      }

      if (result.exitCode !== 0) {
        return [
          buildAgentReachFailure({
            url: fallbackUrl,
            retrievedAt,
            status: "error",
            errorMessage: result.stderr || `agent-reach exit ${result.exitCode}`
          })
        ];
      }

      let parsed: AgentReachResponse;
      try {
        parsed = JSON.parse(result.stdout) as AgentReachResponse;
      } catch (err) {
        return [
          buildAgentReachFailure({
            url: fallbackUrl,
            retrievedAt,
            status: "error",
            errorMessage: `agent-reach parse: ${
              err instanceof Error ? err.message : String(err)
            }`
          })
        ];
      }

      const items = parsed.items ?? [];
      if (items.length === 0) {
        // Successful call, no items — still useful signal for the router.
        return [
          buildAgentReachFailure({
            url: fallbackUrl,
            retrievedAt,
            status: "partial",
            errorMessage: parsed.error || "agent-reach returned no items"
          })
        ];
      }

      return Promise.all(
        items.map(async (item, index) => {
          try {
            return await itemToArtifact(item, index, retrievedAt, fallbackUrl, plan, {
              normalize,
              storeRaw
            });
          } catch (err) {
            const sourceType = coerceSourceType(item.sourceType);
            return buildFailureArtifact({
              id: `${ADAPTER_NAME}-${index}`,
              adapter: ADAPTER_NAME,
              fetcher: FETCHER_NAME,
              url: item.url || fallbackUrl,
              sourceType,
              outcome: {
                status: "error",
                blockReason: "unknown",
                bypassLevel: "none",
                loginRequired: false
              },
              errorMessage: truncateErrorMessage(
                err instanceof Error ? err.message : String(err)
              ),
              sourceLabel: `${sourceType}/error`,
              retrievedAt
            });
          }
        })
      );
    }
  };
}

function buildAgentReachFailure(params: {
  url: string;
  retrievedAt: string;
  status: FetchStatus;
  errorMessage: string;
}): SourceArtifact {
  return buildFailureArtifact({
    id: `${ADAPTER_NAME}-0`,
    adapter: ADAPTER_NAME,
    fetcher: FETCHER_NAME,
    url: params.url,
    sourceType: "web",
    outcome: {
      status: params.status,
      blockReason: "unknown",
      bypassLevel: "none",
      loginRequired: false
    },
    errorMessage: truncateErrorMessage(params.errorMessage),
    sourceLabel: `web/${params.status}`,
    retrievedAt: params.retrievedAt
  });
}
