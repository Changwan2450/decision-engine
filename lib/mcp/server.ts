import path from "node:path";
import { analyzeHotspots } from "@/lib/analytics/hotspot";
import { queryEvents, queryRuns } from "@/lib/analytics/duckdb";
import { buildFailureArtifact } from "@/lib/adapters/contract";
import type { SourceArtifact } from "@/lib/adapters/types";
import { exportRunBundle, ingestAdvisoryFromFile, writeRunStateSnapshot } from "@/lib/bridge/cli-file";
import { sendDiscordNotifierFromFile } from "@/lib/bridge/discord-notifier";
import { exportLinkitIngestBundle } from "@/lib/bridge/linkit-export";
import { publishLinkitBatch } from "@/lib/bridge/linkit-publish";
import { WORKSPACE_ROOT } from "@/lib/config";
import type { Claim, Contradiction, ContradictionKind, SourceTier } from "@/lib/domain/claims";
import { executeResearchRun, fetchWeb, gatherForRun } from "@/lib/orchestrator/run-research";
import { buildWatchDigest } from "@/lib/orchestrator/watch-digest";
import { promoteDigestToProject } from "@/lib/orchestrator/watch-inbox";
import { runSchedulerTick } from "@/lib/orchestrator/watch-scheduler";
import { triggerWatchTarget } from "@/lib/orchestrator/watch-runtime";
import {
  createRunRecord,
  listDigestRecords,
  listInboxItemRecords,
  listWatchTargetRecords,
  readDigestRecord,
  readProjectRecord,
  readRunRecord,
  readWatchTargetRecord,
  updateInboxItemStatus,
  updateRunRecord
} from "@/lib/storage/workspace";

type JsonRpcId = number | string | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

const MCP_PROTOCOL_VERSION = "2024-11-05";

const TOOLS: ToolDefinition[] = [
  {
    name: "get_project",
    description: "Read a project record from the local workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" }
      },
      required: ["projectId"]
    }
  },
  {
    name: "get_run",
    description: "Read a run record from the local workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" }
      },
      required: ["projectId", "runId"]
    }
  },
  {
    name: "show_run_state",
    description: "Write and return the current run-state snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" }
      },
      required: ["projectId", "runId"]
    }
  },
  {
    name: "run_research",
    description: "Create a run from MCP inputs, execute research, and return the resulting run record.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        query: { type: "string" },
        naturalLanguage: { type: "string" },
        pastedContent: { type: "string" },
        urls: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["projectId", "title"]
    }
  },
  {
    name: "clarify_run",
    description: "Merge clarification inputs into an existing run and re-execute research on the same run.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" },
        query: { type: "string" },
        naturalLanguage: { type: "string" },
        pastedContent: { type: "string" },
        urls: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["projectId", "runId"]
    }
  },
  {
    name: "suggest_followup_run",
    description: "Build a follow-up research suggestion from one contradiction without executing a new run.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" },
        contradictionId: { type: "string" }
      },
      required: ["projectId", "runId", "contradictionId"]
    }
  },
  {
    name: "suggest_followup_from_digest",
    description: "Build a follow-up research suggestion directly from a watch digest without promoting it.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        digestId: { type: "string" }
      },
      required: ["projectId", "digestId"]
    }
  },
  {
    name: "run_followup_from_digest",
    description: "Create and execute a follow-up research run directly from a watch digest.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        digestId: { type: "string" }
      },
      required: ["projectId", "digestId"]
    }
  },
  {
    name: "execute_recommended_action",
    description: "Execute an action object returned by recommendedNextAction or nextToolCall.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "object",
          properties: {
            name: { type: "string" },
            arguments: { type: "object" }
          },
          required: ["name", "arguments"]
        }
      },
      required: ["action"]
    }
  },
  {
    name: "fetch_web",
    description: "Fetch a single URL through the router and return one SourceArtifact. Never throws; failures return an artifact.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        opts: { type: "object" }
      },
      required: ["url"]
    }
  },
  {
    name: "gather_for_run",
    description: "Gather all URLs for a run within budget and return collected artifacts. Never throws; failures return artifacts.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" }
      },
      required: ["runId"]
    }
  },
  {
    name: "list_watch_targets",
    description: "List watch targets for a project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" }
      },
      required: ["projectId"]
    }
  },
  {
    name: "get_watch_target",
    description: "Read one watch target from the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        watchTargetId: { type: "string" }
      },
      required: ["projectId", "watchTargetId"]
    }
  },
  {
    name: "trigger_watch",
    description: "Trigger a watch target and return the created run.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        watchTargetId: { type: "string" }
      },
      required: ["projectId", "watchTargetId"]
    }
  },
  {
    name: "list_digests",
    description: "List digests for a project or watch target.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        watchTargetId: { type: "string" }
      },
      required: ["projectId"]
    }
  },
  {
    name: "get_digest",
    description: "Read one digest from the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        digestId: { type: "string" }
      },
      required: ["projectId", "digestId"]
    }
  },
  {
    name: "build_watch_digest",
    description: "Build one digest from watch-linked source runs.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        watchTargetId: { type: "string" },
        sourceRunIds: {
          type: "array",
          items: { type: "string" }
        }
      },
      required: ["projectId", "watchTargetId", "sourceRunIds"]
    }
  },
  {
    name: "list_inbox",
    description: "List inbox items for a project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        status: {
          type: "string",
          enum: ["unread", "read", "archived", "promoted"]
        }
      },
      required: ["projectId"]
    }
  },
  {
    name: "archive_inbox_item",
    description: "Archive one inbox item in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        itemId: { type: "string" }
      },
      required: ["projectId", "itemId"]
    }
  },
  {
    name: "promote_digest_to_project",
    description: "Promote a digest into a normal project run.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        digestId: { type: "string" }
      },
      required: ["projectId", "digestId"]
    }
  },
  {
    name: "run_scheduler_tick",
    description: "Fire all due watch_target triggers based on interval schedule. Returns triggered + skipped.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" }
      }
    }
  },
  {
    name: "export_bundle",
    description: "Export bundle.json and bundle.md for a run.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" }
      },
      required: ["projectId", "runId"]
    }
  },
  {
    name: "export_linkit_ingest",
    description: "Export digest.txt, normalized-items.json, and linkit-ready-items.json for a run.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" }
      },
      required: ["projectId", "runId"]
    }
  },
  {
    name: "publish_linkit_batch",
    description: "Publish linkit-ready items to Linkit and write discord-notifier.json.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" },
        apiBaseUrl: { type: "string" },
        siteUrl: { type: "string" },
        actorEmail: { type: "string" }
      },
      required: ["projectId", "runId", "apiBaseUrl", "siteUrl", "actorEmail"]
    }
  },
  {
    name: "send_discord_notifier",
    description: "Send discord-notifier.json through a Discord webhook.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" },
        webhookUrl: { type: "string" }
      },
      required: ["projectId", "runId", "webhookUrl"]
    }
  },
  {
    name: "ingest_advisory",
    description: "Append advisory.json into the run record.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        runId: { type: "string" },
        provider: { type: "string", enum: ["claude", "codex"] }
      },
      required: ["projectId", "runId", "provider"]
    }
  },
  {
    name: "query_events",
    description: "Query events.jsonl files through DuckDB. Use view name events.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string" }
      },
      required: ["sql"]
    }
  },
  {
    name: "query_runs",
    description: "Query run JSON records through DuckDB. Use view name runs.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string" }
      },
      required: ["sql"]
    }
  },
  {
    name: "analyze_hotspots",
    description: "Analyze a git repo for high-risk files by combining churn frequency and cyclomatic complexity. Returns files ranked by hotspot_score (churn × avg_ccn). Accepts a local absolute path OR a remote git URL (https/git@) — remote repos are auto-cloned. Use before modifying files to identify risk.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string", description: "Absolute local path to git repo, OR a remote git URL (https://... or git@...)" },
        since: { type: "string", description: "Git date range, e.g. '12.month', '6.month', '1.year'. Default: 12.month" },
        limit: { type: "number", description: "Number of top hotspot files to return. Default: 20" }
      },
      required: ["repoPath"]
    }
  }
];

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message }
  };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(`${name} must be a non-empty string array`);
  }
  return value;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function toToolResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

function summarizeArtifacts(artifacts: SourceArtifact[]) {
  return artifacts.slice(0, 3).map((artifact) => ({
    id: artifact.id,
    title: artifact.title,
    url: artifact.url,
    adapter: artifact.adapter,
    sourceType: artifact.sourceType,
    sourcePriority: artifact.sourcePriority,
    sourceTier: artifact.sourceTier ?? "unknown",
    fetchStatus: artifact.metadata.fetch_status,
    snippet: artifact.snippet
  }));
}

function buildTierDistribution(artifacts: SourceArtifact[]): Record<SourceTier, number> {
  return artifacts.reduce<Record<SourceTier, number>>(
    (acc, artifact) => {
      const tier = artifact.sourceTier ?? "unknown";
      acc[tier] += 1;
      return acc;
    },
    {
      official: 0,
      primary: 0,
      internal: 0,
      community: 0,
      aggregator: 0,
      unknown: 0
    }
  );
}

function buildRecommendedNextTools(status: string) {
  if (status === "awaiting_clarification") {
    return ["clarify_run", "get_run"];
  }
  if (status === "decided") {
    return ["show_run_state", "export_bundle", "get_run"];
  }
  if (status === "failed") {
    return ["get_run"];
  }
  return ["get_run", "show_run_state"];
}

const FOLLOWUP_TEMPLATES: Record<
  ContradictionKind,
  {
    suggestedTitle: ((origin: string) => string) | null;
    comparisonAxis: ((origin: string) => string) | null;
    reason: string;
  }
> = {
  internal_vs_community: {
    suggestedTitle: (origin) => `${origin} — 내 KB 대비 최신 커뮤니티 의견 재검증`,
    comparisonAxis: () => "내 KB 기준, 커뮤니티 최신 의견",
    reason: "내부 지식과 커뮤니티 의견이 충돌. 내 KB가 stale일 가능성."
  },
  internal_vs_official: {
    suggestedTitle: (origin) => `${origin} — 공식 문서 기준으로 내 KB 갱신 필요 여부`,
    comparisonAxis: () => "내 KB 기준, 공식 문서 최신",
    reason: "내부 지식과 공식 출처 충돌. 공식이 맞다면 KB 업데이트 후보."
  },
  internal_vs_primary: {
    suggestedTitle: (origin) => `${origin} — 1차 자료 기준 내 KB 갱신 필요 여부`,
    comparisonAxis: () => "내 KB, 1차 자료",
    reason: "내부 지식과 외부 1차 자료 충돌."
  },
  official_vs_community: {
    suggestedTitle: (origin) => `${origin} — 공식 주장 vs 실 사용자 경험 차이`,
    comparisonAxis: () => "공식 주장, 실제 운영 경험",
    reason: "공식 문서와 커뮤니티 경험 충돌. 실 사용 시나리오 확인 필요."
  },
  primary_vs_community: {
    suggestedTitle: (origin) => `${origin} — 1차 데이터 vs 실사용 보고 차이`,
    comparisonAxis: () => "1차 데이터, 현장 경험",
    reason: "1차 자료와 현장 보고 사이 편차."
  },
  aggregator_only: {
    suggestedTitle: null,
    comparisonAxis: null,
    reason: "aggregator-only 충돌 — 원천 재확인 권장, 신규 run 가치 낮음."
  },
  community_only: {
    suggestedTitle: (origin) => `${origin} — 커뮤니티 의견 분산 원인`,
    comparisonAxis: () => "긍정 사례, 부정 사례",
    reason: "커뮤니티 내부에서 의견 분산. 조건별 차이 확인."
  },
  mixed: {
    suggestedTitle: (origin) => `${origin} — 상충 근거 추가 조사`,
    comparisonAxis: () => "긍정 근거, 부정 근거",
    reason: "복수 tier에서 상충 주장. 범위 좁혀 재조사."
  }
};

function buildNextToolCall(record: Awaited<ReturnType<typeof executeResearchRun>>) {
  if (record.run.status === "awaiting_clarification") {
    return {
      name: "clarify_run",
      arguments: {
        projectId: record.run.projectId,
        runId: record.run.id
      }
    };
  }

  if (record.run.status === "decided") {
    return {
      name: "show_run_state",
      arguments: {
        projectId: record.run.projectId,
        runId: record.run.id
      }
    };
  }

  if (record.run.status === "failed") {
    return {
      name: "get_run",
      arguments: {
        projectId: record.run.projectId,
        runId: record.run.id
      }
    };
  }

  return {
    name: "get_run",
    arguments: {
      projectId: record.run.projectId,
      runId: record.run.id
    }
  };
}

function buildClarificationTemplate(record: Awaited<ReturnType<typeof executeResearchRun>>) {
  if (record.run.status !== "awaiting_clarification") return null;

  const contextLines = [
    `현재 제목: ${record.run.title}`,
    `현재 입력: ${record.run.input.naturalLanguage ?? ""}`.trimEnd(),
    `현재 pastedContent: ${record.run.input.pastedContent ?? ""}`.trimEnd()
  ];

  const fieldHints = record.run.clarificationQuestions.map((question) => ({
    question,
    suggestedField:
      /무엇을 결정|목표|goal/i.test(question)
        ? "goal"
        : /누구|대상|target/i.test(question)
          ? "target"
          : /비교|comparison/i.test(question)
            ? "comparisonAxis"
            : "goal"
  }));

  return {
    tool: "clarify_run",
    queryTemplate: [...contextLines, "", "목표: ", "대상: ", "비교: "].join("\n"),
    guidance: "현재 문맥을 유지한 채 빈 칸을 채워 같은 runId로 다시 실행한다.",
    questions: record.run.clarificationQuestions,
    fieldHints
  };
}

function buildContradictionSignals(contradictions: Contradiction[]) {
  return contradictions.map((contradiction) => {
    const kind = contradiction.kind ?? "mixed";
    const template = FOLLOWUP_TEMPLATES[kind];
    return {
      id: contradiction.id,
      kind,
      tierA: contradiction.tierA ?? "unknown",
      tierB: contradiction.tierB ?? "unknown",
      reason: template.reason,
      followupAvailable: template.suggestedTitle !== null
    };
  });
}

function formatTopicKeyForTitle(topicKey: string): string {
  return topicKey.replace(/[-_]+/g, " ").trim();
}

function isLowSignalFollowupClaim(claim: Claim): boolean {
  const text = claim.text.trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    return true;
  }

  return /"kind"\s*:\s*"Listing"|AuthenticationRequiredError|"children"\s*:/u.test(text);
}

function buildFollowupFocus(params: {
  title: string;
  contradiction: Contradiction;
  claims: Claim[];
}): string {
  const claimById = new Map(params.claims.map((claim) => [claim.id, claim]));
  const contradictionClaims = params.contradiction.claimIds
    .map((claimId) => claimById.get(claimId))
    .filter((claim): claim is Claim => Boolean(claim));

  if (contradictionClaims.length === 2) {
    const [left, right] = contradictionClaims;
    if (isLowSignalFollowupClaim(left) || isLowSignalFollowupClaim(right)) {
      return params.title;
    }
    if (left.topicKey && left.topicKey === right.topicKey) {
      return formatTopicKeyForTitle(left.topicKey);
    }
  }

  return params.title;
}

function buildSemanticComparisonAxis(params: {
  contradiction: Contradiction;
  claims: Claim[];
}): string | null {
  const claimById = new Map(params.claims.map((claim) => [claim.id, claim]));
  const contradictionClaims = params.contradiction.claimIds
    .map((claimId) => claimById.get(claimId))
    .filter((claim): claim is Claim => Boolean(claim));

  if (contradictionClaims.length !== 2) {
    return null;
  }

  const [left, right] = contradictionClaims;
  if (isLowSignalFollowupClaim(left) || isLowSignalFollowupClaim(right)) {
    return null;
  }
  if (!left.topicKey || left.topicKey !== right.topicKey) {
    return null;
  }

  const focus = formatTopicKeyForTitle(left.topicKey);
  if (left.stance === "support" && right.stance === "oppose") {
    return `${focus} 찬성 근거, ${focus} 반대 근거`;
  }
  if (left.stance === "oppose" && right.stance === "support") {
    return `${focus} 반대 근거, ${focus} 찬성 근거`;
  }

  return null;
}

function buildSemanticReason(params: {
  contradiction: Contradiction;
  claims: Claim[];
}): string | null {
  const claimById = new Map(params.claims.map((claim) => [claim.id, claim]));
  const contradictionClaims = params.contradiction.claimIds
    .map((claimId) => claimById.get(claimId))
    .filter((claim): claim is Claim => Boolean(claim));

  if (contradictionClaims.length !== 2) {
    return null;
  }

  const [left, right] = contradictionClaims;
  if (isLowSignalFollowupClaim(left) || isLowSignalFollowupClaim(right)) {
    return null;
  }
  if (!left.topicKey || left.topicKey !== right.topicKey) {
    return null;
  }

  return `${formatTopicKeyForTitle(left.topicKey)}에 대해 찬반 근거가 갈리는 조건 재검증.`;
}

function buildFollowupSuggestion(params: {
  title: string;
  contradiction: Contradiction;
  claims: Claim[];
  target?: string;
  comparisonAxis?: string;
}) {
  const kind = params.contradiction.kind ?? "mixed";
  const template = FOLLOWUP_TEMPLATES[kind];

  if (!template.suggestedTitle || !template.comparisonAxis) {
    return null;
  }

  const suggestedComparisonAxis =
    buildSemanticComparisonAxis({
      contradiction: params.contradiction,
      claims: params.claims
    }) ?? template.comparisonAxis(params.title);
  const suggestedReason =
    buildSemanticReason({
      contradiction: params.contradiction,
      claims: params.claims
    }) ?? template.reason;
  return {
    contradictionId: params.contradiction.id,
    kind,
    followup: {
      suggestedTitle: template.suggestedTitle(
        buildFollowupFocus({
          title: params.title,
          contradiction: params.contradiction,
          claims: params.claims
        })
      ),
      suggestedNaturalLanguage: [
        `목표: ${suggestedReason}`,
        `대상: ${params.target ?? "추가 검토 대상"}`,
        `비교: ${suggestedComparisonAxis}`,
        ...(params.comparisonAxis ? [`관점: ${params.comparisonAxis}`] : [])
      ].join("\n"),
      suggestedComparisonAxis
    }
  };
}

function buildDigestFollowupRecommendedNextAction(projectId: string, digestId: string) {
  return {
    name: "run_followup_from_digest",
    arguments: {
      projectId,
      digestId
    }
  };
}

async function buildDigestFollowupSuggestion(params: {
  projectId: string;
  digestId: string;
}) {
  const digest = await readDigestRecord(params.projectId, params.digestId);
  const watchTarget = await readWatchTargetRecord(params.projectId, digest.watchTargetId);
  const runs = await Promise.all(
    digest.sourceRunIds.map((runId) => readRunRecord(params.projectId, runId))
  );

  const contradictionRun = [...runs]
    .reverse()
    .find((run) => run.contradictions.length > 0);

  if (contradictionRun) {
    const contradiction = contradictionRun.contradictions[0];
    if (contradiction) {
      const followup =
        buildFollowupSuggestion({
          title: contradictionRun.run.title,
          contradiction,
          claims: contradictionRun.claims,
          target: contradictionRun.normalizedInput?.target,
          comparisonAxis: contradictionRun.normalizedInput?.comparisonAxis
        }) ?? {
          contradictionId: contradiction.id,
          kind: contradiction.kind ?? "mixed",
          followup: null
        };

      return {
        digestId: digest.id,
        watchTargetId: watchTarget.id,
        sourceRunId: contradictionRun.run.id,
        ...followup
      };
    }
  }

  return {
    digestId: digest.id,
    watchTargetId: watchTarget.id,
    sourceRunId: digest.sourceRunIds[0] ?? null,
    contradictionId: null,
    kind: "digest_review",
    followup: {
      suggestedTitle: `${watchTarget.title} — 신규 근거 검토`,
      suggestedNaturalLanguage: [
        `목표: ${digest.summary}`,
        `대상: ${watchTarget.title}`,
        "비교: 신규 근거"
      ].join("\n"),
      suggestedComparisonAxis: "신규 근거"
    }
  };
}

async function buildDigestFollowupSurface(params: {
  projectId: string;
  digestId: string;
}) {
  const candidate = await buildDigestFollowupSuggestion(params);
  return {
    ...candidate,
    followupAvailable: candidate.followup !== null,
    recommendedNextAction: buildDigestFollowupRecommendedNextAction(
      params.projectId,
      params.digestId
    )
  };
}

async function runFollowupFromDigest(params: {
  projectId: string;
  digestId: string;
  now?: string;
  executeRun?: (projectId: string, runId: string) => Promise<Awaited<ReturnType<typeof readRunRecord>>>;
}) {
  const digest = await readDigestRecord(params.projectId, params.digestId);
  const watchTarget = await readWatchTargetRecord(params.projectId, digest.watchTargetId);
  const digestInboxItems = await listInboxItemRecords(params.projectId);
  const digestInbox = digestInboxItems.find(
    (item) => item.refId === digest.id && item.kind === "digest"
  );
  const suggestion = await buildDigestFollowupSuggestion({
    projectId: params.projectId,
    digestId: params.digestId
  });

  const followup = suggestion.followup;
  if (!followup) {
    throw new Error("digest_followup_not_available");
  }

  const createdRun = await createRunRecord(params.projectId, {
    title: followup.suggestedTitle,
    naturalLanguage: followup.suggestedNaturalLanguage,
    pastedContent: `Follow-up from digest ${digest.id}: ${digest.summary}`,
    urls: watchTarget.query.urls
  });

  await updateRunRecord(params.projectId, createdRun.run.id, (record) => ({
    ...record,
    projectOrigin: {
      source: "watch_digest",
      watchTargetId: digest.watchTargetId,
      digestId: digest.id,
      inboxItemId: digestInbox?.id ?? "",
      sourceRunIds: digest.sourceRunIds
    }
  }));

  const executeRun =
    params.executeRun ?? ((projectId, runId) => executeResearchRun(projectId, runId, { now: params.now }));
  return executeRun(params.projectId, createdRun.run.id);
}

function buildRunBridgePaths(projectId: string, runId: string) {
  const bridgeDir = path.join(WORKSPACE_ROOT, projectId, "runs", runId, "bridge");
  return {
    bridgeDir,
    bundlePath: path.join(bridgeDir, "bundle.md"),
    snapshotPath: path.join(bridgeDir, "run-state.json")
  };
}

function withMcpSummary(record: Awaited<ReturnType<typeof executeResearchRun>>) {
  const paths = buildRunBridgePaths(record.run.projectId, record.run.id);
  return {
    ...record,
    mcpSummary: {
      runId: record.run.id,
      status: record.run.status,
      decision: record.decision
        ? {
            value: record.decision.value,
            confidence: record.decision.confidence,
            why: record.decision.why
          }
        : null,
      clarificationQuestions: record.run.clarificationQuestions,
      topArtifacts: summarizeArtifacts(record.artifacts),
      tierDistribution: buildTierDistribution(record.artifacts),
      contradictionSignals: buildContradictionSignals(record.contradictions),
      expandedQueries: record.expansion?.expanded ?? [],
      expansionDropped: record.expansion?.dropped ?? 0,
      paths,
      recommendedNextTools: buildRecommendedNextTools(record.run.status),
      nextToolCall: buildNextToolCall(record),
      clarificationTemplate: buildClarificationTemplate(record)
    }
  };
}

async function mergeClarificationInput(
  projectId: string,
  runId: string,
  args: Record<string, unknown> | undefined
) {
  const naturalLanguage = optionalString(args?.query) ?? optionalString(args?.naturalLanguage);
  const pastedContent = optionalString(args?.pastedContent);
  const urls = optionalStringArray(args?.urls, "urls");

  return updateRunRecord(projectId, runId, (record) => ({
    ...record,
    run: {
      ...record.run,
      input: {
        naturalLanguage: naturalLanguage ?? record.run.input.naturalLanguage,
        pastedContent: pastedContent ?? record.run.input.pastedContent,
        urls: urls ?? record.run.input.urls
      }
    }
  }));
}

function buildMcpFailureArtifact(params: {
  adapter: "mcp/fetch_web" | "mcp/gather_for_run";
  url?: string;
  errorMessage: string;
}) {
  return buildFailureArtifact({
    id: `${params.adapter}-0`,
    adapter: params.adapter,
    fetcher: params.adapter,
    url: params.url ?? "",
    sourceType: "web",
    outcome: { status: "error" },
    errorMessage: params.errorMessage,
    sourceLabel: "web/error"
  });
}

async function callTool(
  name: string,
  args: Record<string, unknown> | undefined,
  deps?: {
    executeResearchRun?: typeof executeResearchRun;
    fetchWeb?: typeof fetchWeb;
    gatherForRun?: typeof gatherForRun;
    triggerWatch?: typeof triggerWatchTarget;
    buildWatchDigest?: typeof buildWatchDigest;
    promoteDigestToProject?: typeof promoteDigestToProject;
    runSchedulerTick?: typeof runSchedulerTick;
  }
): Promise<ReturnType<typeof toToolResult>> {
  const projectId = args?.projectId;
  const runId = args?.runId;
  const executeResearchRunFn = deps?.executeResearchRun ?? executeResearchRun;
  const fetchWebFn = deps?.fetchWeb ?? fetchWeb;
  const gatherForRunFn = deps?.gatherForRun ?? gatherForRun;
  const triggerWatchFn = deps?.triggerWatch ?? triggerWatchTarget;
  const buildWatchDigestFn = deps?.buildWatchDigest ?? buildWatchDigest;
  const promoteDigestToProjectFn =
    deps?.promoteDigestToProject ?? promoteDigestToProject;
  const runSchedulerTickFn = deps?.runSchedulerTick ?? runSchedulerTick;

  switch (name) {
    case "get_project": {
      const record = await readProjectRecord(requireString(projectId, "projectId"));
      return toToolResult(record);
    }
    case "get_run": {
      const record = await readRunRecord(
        requireString(projectId, "projectId"),
        requireString(runId, "runId")
      );
      return toToolResult(record);
    }
    case "show_run_state": {
      const snapshotPath = await writeRunStateSnapshot(
        requireString(projectId, "projectId"),
        requireString(runId, "runId")
      );
      return toToolResult({ projectId, runId, snapshotPath });
    }
    case "run_research": {
      const createdRun = await createRunRecord(requireString(projectId, "projectId"), {
        title: requireString(args?.title, "title"),
        naturalLanguage: optionalString(args?.query) ?? optionalString(args?.naturalLanguage),
        pastedContent: optionalString(args?.pastedContent),
        urls: optionalStringArray(args?.urls, "urls")
      });
      const record = await executeResearchRunFn(createdRun.run.projectId, createdRun.run.id);
      return toToolResult(withMcpSummary(record));
    }
    case "clarify_run": {
      const targetProjectId = requireString(projectId, "projectId");
      const targetRunId = requireString(runId, "runId");
      await mergeClarificationInput(targetProjectId, targetRunId, args);
      const record = await executeResearchRunFn(targetProjectId, targetRunId);
      return toToolResult(withMcpSummary(record));
    }
    case "suggest_followup_run": {
      const targetProjectId = requireString(projectId, "projectId");
      const targetRunId = requireString(runId, "runId");
      const contradictionId = requireString(args?.contradictionId, "contradictionId");
      let record;
      try {
        record = await readRunRecord(targetProjectId, targetRunId);
      } catch {
        throw new Error("run_not_found");
      }
      const contradiction = record.contradictions.find((entry) => entry.id === contradictionId);
      if (!contradiction) {
        throw new Error("contradiction_not_found");
      }
      return toToolResult(
        buildFollowupSuggestion({
          title: record.run.title,
          contradiction,
          claims: record.claims,
          target: record.normalizedInput?.target,
          comparisonAxis: record.normalizedInput?.comparisonAxis
        }) ?? {
          contradictionId,
          kind: contradiction.kind ?? "mixed",
          followup: null
        }
      );
    }
    case "suggest_followup_from_digest": {
      const targetProjectId = requireString(projectId, "projectId");
      const digestId = requireString(args?.digestId, "digestId");
      return toToolResult(
        await buildDigestFollowupSurface({
          projectId: targetProjectId,
          digestId
        })
      );
    }
    case "run_followup_from_digest": {
      const targetProjectId = requireString(projectId, "projectId");
      const digestId = requireString(args?.digestId, "digestId");
      const followupCandidate = await buildDigestFollowupSurface({
        projectId: targetProjectId,
        digestId
      });
      const record = await runFollowupFromDigest({
        projectId: targetProjectId,
        digestId,
        executeRun: executeResearchRunFn
      });
      return toToolResult({
        ...withMcpSummary(record),
        followupCandidate
      });
    }
    case "execute_recommended_action": {
      const action = requireObject(args?.action, "action");
      const actionName = requireString(action.name, "action.name");
      if (actionName === "execute_recommended_action") {
        throw new Error("execute_recommended_action cannot execute itself");
      }
      const actionArgs = requireObject(action.arguments, "action.arguments");
      return toToolResult({
        executedAction: {
          name: actionName,
          arguments: actionArgs
        },
        result: (await callTool(actionName, actionArgs, deps)).structuredContent
      });
    }
    case "fetch_web": {
      const url = requireString(args?.url, "url");
      try {
        return toToolResult(await fetchWebFn(url));
      } catch (error) {
        return toToolResult(
          buildMcpFailureArtifact({
            adapter: "mcp/fetch_web",
            url,
            errorMessage: error instanceof Error ? error.message : String(error)
          })
        );
      }
    }
    case "gather_for_run": {
      const targetRunId = requireString(args?.runId, "runId");
      try {
        return toToolResult({
          runId: targetRunId,
          artifacts: await gatherForRunFn(targetRunId)
        });
      } catch (error) {
        return toToolResult({
          runId: targetRunId,
          artifacts: [
            buildMcpFailureArtifact({
              adapter: "mcp/gather_for_run",
              errorMessage: error instanceof Error ? error.message : String(error)
            })
          ]
        });
      }
    }
    case "list_watch_targets": {
      const records = await listWatchTargetRecords(requireString(projectId, "projectId"));
      return toToolResult({ projectId, watchTargets: records });
    }
    case "get_watch_target": {
      const record = await readWatchTargetRecord(
        requireString(projectId, "projectId"),
        requireString(args?.watchTargetId, "watchTargetId")
      );
      return toToolResult(record);
    }
    case "trigger_watch": {
      const record = await triggerWatchFn(
        requireString(projectId, "projectId"),
        requireString(args?.watchTargetId, "watchTargetId")
      );
      return toToolResult(record);
    }
    case "list_digests": {
      const targetProjectId = requireString(projectId, "projectId");
      const watchTargetId =
        typeof args?.watchTargetId === "string" && args.watchTargetId.length > 0
          ? args.watchTargetId
          : undefined;
      const digests = await listDigestRecords(targetProjectId);
      const filteredDigests = watchTargetId
        ? digests.filter((digest) => digest.watchTargetId === watchTargetId)
        : digests;
      const followupByDigestId = new Map(
        (
          await Promise.all(
            filteredDigests.map(async (digest) => [
              digest.id,
              await buildDigestFollowupSurface({
                projectId: targetProjectId,
                digestId: digest.id
              })
            ] as const)
          )
        )
      );
      return toToolResult({
        projectId: targetProjectId,
        digests: filteredDigests.map((digest) => {
          const followupCandidate = followupByDigestId.get(digest.id);
          return {
            ...digest,
            followupCandidate,
            recommendedNextAction: followupCandidate?.recommendedNextAction
          };
        })
      });
    }
    case "get_digest": {
      const targetProjectId = requireString(projectId, "projectId");
      const digestId = requireString(args?.digestId, "digestId");
      const record = await readDigestRecord(targetProjectId, digestId);
      const followupCandidate = await buildDigestFollowupSurface({
        projectId: targetProjectId,
        digestId
      });
      return toToolResult({
        ...record,
        followupCandidate,
        recommendedNextAction: followupCandidate.recommendedNextAction
      });
    }
    case "build_watch_digest": {
      const record = await buildWatchDigestFn(
        requireString(projectId, "projectId"),
        requireString(args?.watchTargetId, "watchTargetId"),
        {
          sourceRunIds: requireStringArray(args?.sourceRunIds, "sourceRunIds")
        }
      );
      return toToolResult(record);
    }
    case "list_inbox": {
      const targetProjectId = requireString(projectId, "projectId");
      const status =
        typeof args?.status === "string" && args.status.length > 0
          ? args.status
          : undefined;
      if (
        status &&
        status !== "unread" &&
        status !== "read" &&
        status !== "archived" &&
        status !== "promoted"
      ) {
        throw new Error("status must be unread, read, archived, or promoted");
      }
      const items = await listInboxItemRecords(targetProjectId);
      const filteredItems = status ? items.filter((item) => item.status === status) : items;
      const digestFollowupByRefId = new Map(
        (
          await Promise.all(
            filteredItems.map(async (item) => {
              if (item.kind !== "digest" && item.kind !== "alert") {
                return [item.refId, null] as const;
              }
              return [
                item.refId,
                await buildDigestFollowupSurface({
                  projectId: targetProjectId,
                  digestId: item.refId
                })
              ] as const;
            })
          )
        ).filter((entry): entry is readonly [string, Awaited<ReturnType<typeof buildDigestFollowupSurface>>] => entry[1] !== null)
      );
      return toToolResult({
        projectId: targetProjectId,
        inboxItems: filteredItems.map((item) => {
          const followupCandidate = digestFollowupByRefId.get(item.refId);
          return {
            ...item,
            followupCandidate,
            recommendedNextAction: followupCandidate?.recommendedNextAction
          };
        })
      });
    }
    case "archive_inbox_item": {
      const record = await updateInboxItemStatus(
        requireString(projectId, "projectId"),
        requireString(args?.itemId, "itemId"),
        "archived"
      );
      return toToolResult(record);
    }
    case "promote_digest_to_project": {
      const record = await promoteDigestToProjectFn(
        requireString(projectId, "projectId"),
        requireString(args?.digestId, "digestId")
      );
      return toToolResult(record);
    }
    case "run_scheduler_tick": {
      const targetProjectId =
        typeof projectId === "string" && projectId.length > 0 ? projectId : undefined;
      return toToolResult(
        await runSchedulerTickFn({
          projectId: targetProjectId
        })
      );
    }
    case "export_bundle": {
      const bundleDir = await exportRunBundle(
        requireString(projectId, "projectId"),
        requireString(runId, "runId")
      );
      return toToolResult({ projectId, runId, bundleDir });
    }
    case "export_linkit_ingest": {
      const result = await exportLinkitIngestBundle(
        requireString(projectId, "projectId"),
        requireString(runId, "runId")
      );
      return toToolResult(result);
    }
    case "publish_linkit_batch": {
      const result = await publishLinkitBatch(
        requireString(projectId, "projectId"),
        requireString(runId, "runId"),
        {
          apiBaseUrl: requireString(args?.apiBaseUrl, "apiBaseUrl"),
          siteUrl: requireString(args?.siteUrl, "siteUrl"),
          actorEmail: requireString(args?.actorEmail, "actorEmail")
        }
      );
      return toToolResult(result);
    }
    case "send_discord_notifier": {
      const result = await sendDiscordNotifierFromFile(
        requireString(projectId, "projectId"),
        requireString(runId, "runId"),
        {
          webhookUrl: requireString(args?.webhookUrl, "webhookUrl")
        }
      );
      return toToolResult(result);
    }
    case "ingest_advisory": {
      const provider = requireString(args?.provider, "provider");
      if (provider !== "claude" && provider !== "codex") {
        throw new Error("provider must be claude or codex");
      }
      await ingestAdvisoryFromFile(
        requireString(projectId, "projectId"),
        requireString(runId, "runId"),
        provider
      );
      return toToolResult({ projectId, runId, provider, ingested: true });
    }
    case "query_events":
      return toToolResult({ rows: await queryEvents(requireString(args?.sql, "sql")) });
    case "query_runs":
      return toToolResult({ rows: await queryRuns(requireString(args?.sql, "sql")) });
    case "analyze_hotspots": {
      const repoPath = requireString(args?.repoPath, "repoPath");
      const since = typeof args?.since === "string" ? args.since : "12.month";
      const limit = typeof args?.limit === "number" ? args.limit : 20;
      const rows = await analyzeHotspots(repoPath, since, limit);
      return toToolResult({ repoPath, since, limit, rows });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function createMcpHandler(deps?: {
  executeResearchRun?: typeof executeResearchRun;
  fetchWeb?: typeof fetchWeb;
  gatherForRun?: typeof gatherForRun;
  triggerWatch?: typeof triggerWatchTarget;
  buildWatchDigest?: typeof buildWatchDigest;
  promoteDigestToProject?: typeof promoteDigestToProject;
  runSchedulerTick?: typeof runSchedulerTick;
}) {
  return async function handleMcpRequest(
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse | null> {
    const id = request.id ?? null;

    try {
      switch (request.method) {
        case "initialize":
          return ok(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: "decision-engine",
              version: "0.1.0"
            }
          });
        case "notifications/initialized":
          return null;
        case "ping":
          return ok(id, {});
        case "tools/list":
          return ok(id, { tools: TOOLS });
        case "tools/call": {
          const name = requireString(request.params?.name, "name");
          const args =
            request.params?.arguments && typeof request.params.arguments === "object"
              ? (request.params.arguments as Record<string, unknown>)
              : {};
          return ok(id, await callTool(name, args, deps));
        }
        default:
          return fail(id, -32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      return fail(id, -32000, error instanceof Error ? error.message : "Unknown MCP error");
    }
  };
}

export const handleMcpRequest = createMcpHandler();
