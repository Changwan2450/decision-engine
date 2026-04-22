import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { OBSIDIAN_VAULT_PATH } from "@/lib/config";
import type { KnowledgeContext, KnowledgeContextNote, SourceArtifact } from "@/lib/adapters/types";
import type { ProjectRecord, RunRecord } from "@/lib/storage/schema";
import {
  CONTEXT_BOUNDARY_SPEC,
  RESEARCH_QUALITY_CONTRACT_VERSION,
  type ResearchRunType
} from "@/lib/orchestrator/research-quality-contract";

const execFileAsync = promisify(execFile);
const ALWAYS_ON_OPERATOR_NOTE_PATHS = new Set([
  "concepts/user-working-profile.md"
]);
const QMD_COLLECTION = "wiki";
const QMD_QUERY_LIMIT = "15";
const QMD_QUERY_MIN_SCORE = "0.35";

type QmdClient = {
  queryNotes: (searchText: string) => Promise<KnowledgeContextNote[]>;
  operatorNotes: () => Promise<KnowledgeContextNote[]>;
};

type QmdRunner = (args: string[], vaultRoot: string) => Promise<string>;

type QmdQueryRow = {
  file: string;
  title?: string;
};

type QmdDocumentRow = {
  file: string;
  title?: string;
  body?: string;
};

let qmdClientOverride: QmdClient | null = null;
let qmdRunnerOverride: QmdRunner | null = null;
let resolvedQmdRuntime:
  | {
      nodePath: string;
      scriptPath: string;
    }
  | null
  | undefined;

function takeUnique(values: string[], limit: number): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

function extractTitle(markdown: string, fallback: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || fallback;
}

function extractSection(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(
    new RegExp(`^##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=^##\\s+|\\Z)`, "m")
  );
  return match?.[1]?.trim() ?? "";
}

function extractBulletList(markdown: string, heading: string): string[] {
  return extractSection(markdown, heading)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /, "").trim());
}

function extractSummary(markdown: string): string {
  const summary = extractSection(markdown, "Summary");
  if (summary) {
    return summary.split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
  }
  return "";
}

function normalizeRelativePath(notePath: string): string {
  return notePath
    .replace(/\\/g, "/")
    .replace(/^qmd:\/\/wiki\//, "")
    .replace(/^wiki\//, "");
}

function toStoredPath(notePath: string): string {
  return `wiki/${normalizeRelativePath(notePath)}`;
}

function toQmdPath(notePath: string): string {
  return `qmd://${QMD_COLLECTION}/${normalizeRelativePath(notePath)}`;
}

async function resolveQmdRuntime(): Promise<{
  nodePath: string;
  scriptPath: string;
} | null> {
  if (resolvedQmdRuntime !== undefined) {
    return resolvedQmdRuntime;
  }

  try {
    const { stdout } = await execFileAsync("sh", ["-lc", "command -v qmd"]);
    const qmdPath = stdout.trim();
    if (!qmdPath) {
      resolvedQmdRuntime = null;
      return resolvedQmdRuntime;
    }

    const realQmdPath = await realpath(qmdPath);
    const packageRoot = path.dirname(path.dirname(realQmdPath));
    const nodePath = path.join(packageRoot, "..", "..", "..", "..", "bin", "node");
    const scriptPath = path.join(packageRoot, "dist", "cli", "qmd.js");

    resolvedQmdRuntime = {
      nodePath,
      scriptPath
    };
    return resolvedQmdRuntime;
  } catch {
    resolvedQmdRuntime = null;
    return resolvedQmdRuntime;
  }
}

async function runQmd(args: string[], vaultRoot: string): Promise<string> {
  if (qmdRunnerOverride) {
    return qmdRunnerOverride(args, vaultRoot);
  }
  const runtime = await resolveQmdRuntime();
  const commandArgs =
    args[0] === "query" && !args.includes("--no-rerank") ? [...args, "--no-rerank"] : args;

  const { stdout } = await execFileAsync(runtime?.nodePath ?? "qmd", runtime
    ? [runtime.scriptPath, ...commandArgs]
    : commandArgs, {
    cwd: vaultRoot,
    env: {
      ...process.env,
      QMD_LLAMA_GPU: process.env.QMD_LLAMA_GPU ?? "false"
    },
    maxBuffer: 1024 * 1024 * 10
  });
  return stdout;
}

function noteFromMarkdown(markdown: string, filePath: string, fallbackTitle = ""): KnowledgeContextNote {
  return {
    title: extractTitle(markdown, fallbackTitle || normalizeRelativePath(filePath).replace(/\.md$/, "")),
    path: toStoredPath(filePath),
    summary: extractSummary(markdown),
    reusableClaims: extractBulletList(markdown, "Reusable Claims")
  };
}

async function qmdMultiGet(vaultRoot: string, files: string[]): Promise<KnowledgeContextNote[]> {
  if (files.length === 0) {
    return [];
  }
  const stdout = await runQmd(
    ["multi-get", files.map((file) => toQmdPath(file)).join(","), "--json"],
    vaultRoot
  );
  try {
    const rows = JSON.parse(stdout) as QmdDocumentRow[];
    return rows
      .filter((row) => typeof row.file === "string" && typeof row.body === "string")
      .map((row) => noteFromMarkdown(row.body ?? "", row.file, row.title ?? ""))
      .filter((note) => note.title.length > 0);
  } catch (error) {
    console.warn(
      `[kb-context] qmd multi-get JSON parse failed (files=${files.length}); falling back to per-file get:`,
      error instanceof Error ? error.message : String(error)
    );
    const notes = await Promise.all(
      files.map(async (file) => {
        const markdown = await runQmd(["get", toQmdPath(file)], vaultRoot);
        return noteFromMarkdown(markdown, file);
      })
    );
    return notes.filter((note) => note.title.length > 0);
  }
}

function buildDefaultQmdClient(vaultRoot: string): QmdClient {
  return {
    async queryNotes(searchText: string) {
      const stdout = await runQmd(
        [
          "query",
          searchText,
          "--json",
          "-n",
          QMD_QUERY_LIMIT,
          "--min-score",
          QMD_QUERY_MIN_SCORE,
          "-c",
          QMD_COLLECTION
        ],
        vaultRoot
      );
      const rows = JSON.parse(stdout) as QmdQueryRow[];
      const files = Array.from(
        new Set(
          rows
            .map((row) => row.file)
            .filter((file): file is string => typeof file === "string")
            .map(normalizeRelativePath)
            .filter((file) => !ALWAYS_ON_OPERATOR_NOTE_PATHS.has(file))
        )
      ).slice(0, 3);
      return qmdMultiGet(vaultRoot, files);
    },
    async operatorNotes() {
      return qmdMultiGet(vaultRoot, Array.from(ALWAYS_ON_OPERATOR_NOTE_PATHS));
    }
  };
}

function getQmdClient(vaultRoot: string): QmdClient {
  return qmdClientOverride ?? buildDefaultQmdClient(vaultRoot);
}

export function createQmdClientForTests(vaultRoot: string): QmdClient {
  return buildDefaultQmdClient(vaultRoot);
}

export function setQmdClientForTests(client: QmdClient | null): void {
  qmdClientOverride = client;
}

export function setQmdRunnerForTests(runner: QmdRunner | null): void {
  qmdRunnerOverride = runner;
}

export async function buildKnowledgeContext(params: {
  record: RunRecord;
  projectRecord: ProjectRecord;
  runRecords: RunRecord[];
  vaultRoot?: string;
}): Promise<KnowledgeContext> {
  const { record, projectRecord, runRecords } = params;
  const vaultRoot = params.vaultRoot ?? process.env.OBSIDIAN_VAULT_PATH ?? OBSIDIAN_VAULT_PATH;
  const searchText = [
    record.run.title,
    record.run.input.naturalLanguage ?? "",
    record.run.input.pastedContent ?? "",
    record.normalizedInput?.goal ?? "",
    record.normalizedInput?.target ?? "",
    record.normalizedInput?.comparisonAxis ?? ""
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const qmdClient = getQmdClient(vaultRoot);
  const [operatorNotes, queriedNotes] = await Promise.all([
    qmdClient.operatorNotes(),
    qmdClient.queryNotes(searchText)
  ]);
  const scoredNotes = queriedNotes.slice(0, 3);

  const activeDecisionLedger = (projectRecord.memory?.decisionLedger ?? []).filter((entry) =>
    isActiveGovernedMemoryEntry(entry, record.run.createdAt)
  );
  const activeTopicLedger = (projectRecord.memory?.topicLedger ?? []).filter((entry) =>
    isActiveGovernedMemoryEntry(entry, record.run.createdAt)
  );
  const activeContradictionLedger = (projectRecord.memory?.contradictionLedger ?? []).filter((entry) =>
    isActiveGovernedMemoryEntry(entry, record.run.createdAt)
  );
  const currentRunType = inferCurrentRunType(record);
  const currentContextClass = CONTEXT_BOUNDARY_SPEC.classes[currentRunType];
  const preferredComparisonAxes = takeUnique(
    activeDecisionLedger
      .filter(
        (entry) =>
          entry.contextClass === currentContextClass &&
          entry.confidence === "high" &&
          !!entry.comparisonAxis
      )
      .map((entry) => entry.comparisonAxis ?? "")
      .filter(Boolean),
    3
  );
  const trustQualifiedTopics = takeUnique(
    activeTopicLedger
      .filter((entry) => entry.highTrustCount > 0)
      .sort((left, right) => {
        const leftScore = left.highTrustCount * 10 + left.count;
        const rightScore = right.highTrustCount * 10 + right.count;
        return rightScore - leftScore || right.lastSeenAt.localeCompare(left.lastSeenAt);
      })
      .slice(0, 2)
      .map((entry) => entry.topicKey),
    2
  );
  const prioritizedTopics = takeUnique(
    trustQualifiedTopics.length > 0
      ? trustQualifiedTopics
      : activeTopicLedger
          .sort((left, right) => right.count - left.count || right.lastSeenAt.localeCompare(left.lastSeenAt))
          .slice(0, 2)
          .map((entry) => entry.topicKey),
    2
  );
  const reviewBias: "fresh_first" | "comparison_axes_first" | "contradiction_first" =
    activeContradictionLedger.length > 0 && trustQualifiedTopics.length > 0
      ? "contradiction_first"
      : preferredComparisonAxes.length > 0
        ? "comparison_axes_first"
        : "fresh_first";
  const appliedAdjustments = [
    ...(preferredComparisonAxes.length > 0
      ? [`comparison-axis-priority:${preferredComparisonAxes.join(" | ")}`]
      : []),
    ...(trustQualifiedTopics.length > 0
      ? [`trust-topic-priority:${trustQualifiedTopics.join(" | ")}`]
      : []),
    ...(prioritizedTopics.length > 0
      ? [`topic-priority:${prioritizedTopics.join(" | ")}`]
      : []),
    ...(activeContradictionLedger.length > 0 && trustQualifiedTopics.length > 0
      ? ["contradiction-first-review"]
      : [])
  ];
  const adaptivePolicy =
    appliedAdjustments.length > 0
      ? {
          mode: "project_adaptive" as const,
          contextClass: currentContextClass,
          preferredComparisonAxes,
          prioritizedTopics,
          trustQualifiedTopics,
          reviewBias,
          appliedAdjustments
        }
      : {
          mode: "fresh" as const,
          contextClass: currentContextClass,
          preferredComparisonAxes: [],
          prioritizedTopics: [],
          trustQualifiedTopics: [],
          reviewBias: "fresh_first" as const,
          appliedAdjustments: []
        };

  const priorDecisions = (
    activeDecisionLedger.length
      ? activeDecisionLedger
      : runRecords
          .filter((run) => run.run.id !== record.run.id && run.run.status === "decided" && run.decision)
          .map((run) => ({
            runId: run.run.id,
            title: run.run.title,
            decision: run.decision!.value,
            confidence: run.decision!.confidence,
            why: run.decision!.why,
            createdAt: run.run.createdAt
          }))
  )
    .filter((run) => run.runId !== record.run.id)
    .slice(0, 3)
    .map((run) => ({
      runId: run.runId,
      title: run.title,
      decision: run.decision,
      why: run.why,
      createdAt: run.createdAt
    }));

  const memoryTopics = activeTopicLedger
    .sort((left, right) => right.count - left.count || right.lastSeenAt.localeCompare(left.lastSeenAt))
    .slice(0, 3)
    .map((entry) => `${entry.topicKey} (${entry.count})`);
  const contradictionTopics = activeContradictionLedger
    .sort((left, right) => right.count - left.count || right.lastSeenAt.localeCompare(left.lastSeenAt))
    .slice(0, 3)
    .map((entry) => `${entry.topicKey} (${entry.count})`);

  const queryExpansion = takeUnique(
    [
      ...preferredComparisonAxes,
      ...prioritizedTopics,
      ...scoredNotes.map((note) => note.title),
      ...scoredNotes.flatMap((note) => note.reusableClaims.slice(0, 2)),
      ...projectRecord.insights.repeatedProblems,
      ...projectRecord.insights.repeatedPatterns,
      ...projectRecord.insights.competitorSignals,
      ...memoryTopics
    ],
    8
  );

  const duplicateWarnings = takeUnique(
    [
      ...priorDecisions.map(
        (decision) => `이미 다룬 런: ${decision.title} (${decision.decision})`
      ),
      ...projectRecord.promotionCandidates.map(
        (candidate) => `이미 승격 후보에 있는 패턴: ${candidate.title}`
      ),
      ...contradictionTopics.map((topic) => `반복 상충 토픽: ${topic}`)
    ],
    6
  );

  const freshEvidenceFocus = takeUnique(
    [
      ...prioritizedTopics.map((topic) => `우선 재검증 토픽: ${topic}`),
      ...projectRecord.insights.competitorSignals.map(
        (signal) => `최신 경쟁사 근거로 재검증: ${signal}`
      ),
      ...projectRecord.insights.repeatedProblems.map(
        (problem) => `반복 문제의 최신 지속 여부 확인: ${problem}`
      ),
      ...contradictionTopics.map((topic) => `상충 토픽 재검증: ${topic}`),
      "기존 내부 지식을 반복하지 말고 최신 official/primary_data 근거를 우선 수집"
    ],
    6
  );

  return {
    operatorNotes,
    wikiNotes: scoredNotes,
    priorDecisions,
    queryExpansion,
    duplicateWarnings,
    freshEvidenceFocus,
    adaptivePolicy
  };
}

function isActiveGovernedMemoryEntry(
  entry: { contractVersion: string; expiresAt: string | null },
  now: string
): boolean {
  return (
    entry.contractVersion === RESEARCH_QUALITY_CONTRACT_VERSION &&
    typeof entry.expiresAt === "string" &&
    entry.expiresAt > now
  );
}

function inferCurrentRunType(record: Pick<RunRecord, "watchContext" | "normalizedInput">): ResearchRunType {
  if (record.watchContext?.watchTargetId) {
    return "longitudinal_watch";
  }

  const title = record.normalizedInput?.title ?? "";
  const naturalLanguage = record.normalizedInput?.naturalLanguage ?? "";
  const goal = record.normalizedInput?.goal ?? "";
  const comparisonAxis = record.normalizedInput?.comparisonAxis ?? "";
  const haystack = [title, naturalLanguage, goal, comparisonAxis].join(" ").toLowerCase();

  if (comparisonAxis || /\bvs\b|versus|대/.test(haystack)) {
    return "comparison_tradeoff_analysis";
  }
  if (/상충|contradiction|반증|re-?check/.test(haystack)) {
    return "contradiction_resolution";
  }
  if (/결정|판단|verify|verification|검증/.test(haystack)) {
    return "pre_decision_verification";
  }
  return "exploratory_scan";
}

function stanceFromDecision(value: "go" | "no_go" | "unclear"): "support" | "oppose" | "neutral" {
  if (value === "go") {
    return "support";
  }
  if (value === "no_go") {
    return "oppose";
  }
  return "neutral";
}

export function buildKnowledgeArtifacts(
  context: KnowledgeContext | null,
  runId: string
): SourceArtifact[] {
  if (!context) {
    return [];
  }

  const artifacts: SourceArtifact[] = [];

  if (context.wikiNotes.length > 0) {
    const claims = context.wikiNotes.flatMap((note) =>
      (note.reusableClaims.length > 0 ? note.reusableClaims.slice(0, 2) : [note.summary])
        .filter(Boolean)
        .map((claim) => ({
        text: claim,
        topicKey: note.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-"),
        stance: "support" as const
      }))
    );

    artifacts.push({
      id: `kb-preread-wiki-${runId}`,
      adapter: "kb-preread",
      sourceType: "kb",
      title: "KB Wiki Prior",
      url: `https://kb.local/wiki/${runId}`,
      snippet: context.wikiNotes.map((note) => `${note.title}: ${note.summary}`).join("\n"),
      content: context.wikiNotes
        .map((note) => `- ${note.title}: ${note.summary}`.trim())
        .join("\n"),
      sourcePriority: "analysis",
      metadata: {
        claims_json: JSON.stringify(claims),
        kb_paths: context.wikiNotes.map((note) => note.path).join(" | ")
      }
    });
  }

  if (context.priorDecisions.length > 0) {
    artifacts.push({
      id: `kb-preread-decisions-${runId}`,
      adapter: "kb-preread",
      sourceType: "kb",
      title: "Decision History Prior",
      url: `https://kb.local/decision-history/${runId}`,
      snippet: context.priorDecisions
        .map((decision) => `${decision.title}: ${decision.decision}`)
        .join("\n"),
      content: context.priorDecisions
        .map((decision) => `- ${decision.title}: ${decision.why}`)
        .join("\n"),
      sourcePriority: "analysis",
      metadata: {
        claims_json: JSON.stringify(
          context.priorDecisions.map((decision) => ({
            text: `${decision.title}: ${decision.why}`,
            topicKey: "project-prior-decision",
            stance: stanceFromDecision(decision.decision)
          }))
        )
      }
    });
  }

  return artifacts;
}
