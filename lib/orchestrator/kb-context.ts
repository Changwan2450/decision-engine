import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OBSIDIAN_VAULT_PATH } from "@/lib/config";
import type { KnowledgeContext, KnowledgeContextNote, SourceArtifact } from "@/lib/adapters/types";
import type { ProjectRecord, RunRecord } from "@/lib/storage/schema";

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

async function runQmd(args: string[], vaultRoot: string): Promise<string> {
  const { stdout } = await execFileAsync("qmd", args, {
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
  const rows = JSON.parse(stdout) as QmdDocumentRow[];
  return rows
    .filter((row) => typeof row.file === "string" && typeof row.body === "string")
    .map((row) => noteFromMarkdown(row.body ?? "", row.file, row.title ?? ""))
    .filter((note) => note.title.length > 0);
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

export function setQmdClientForTests(client: QmdClient | null): void {
  qmdClientOverride = client;
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

  const priorDecisions = runRecords
    .filter((run) => run.run.id !== record.run.id && run.run.status === "decided" && run.decision)
    .slice(0, 3)
    .map((run) => ({
      runId: run.run.id,
      title: run.run.title,
      decision: run.decision!.value,
      why: run.decision!.why,
      createdAt: run.run.createdAt
    }));

  const queryExpansion = takeUnique(
    [
      ...scoredNotes.map((note) => note.title),
      ...scoredNotes.flatMap((note) => note.reusableClaims.slice(0, 2)),
      ...projectRecord.insights.repeatedProblems,
      ...projectRecord.insights.repeatedPatterns,
      ...projectRecord.insights.competitorSignals
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
      )
    ],
    6
  );

  const freshEvidenceFocus = takeUnique(
    [
      ...projectRecord.insights.competitorSignals.map(
        (signal) => `최신 경쟁사 근거로 재검증: ${signal}`
      ),
      ...projectRecord.insights.repeatedProblems.map(
        (problem) => `반복 문제의 최신 지속 여부 확인: ${problem}`
      ),
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
    freshEvidenceFocus
  };
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
