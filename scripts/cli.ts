#!/usr/bin/env tsx
import { pathToFileURL } from "node:url";
import { parseCliAdvisoryOutput } from "@/lib/bridge/cli-invoke";
import {
  exportRunBundle,
  ingestAdvisoryFromFile,
  writeAdvisoryResult
} from "@/lib/bridge/cli-file";
import {
  createProjectRecord,
  createRunRecord,
  listProjectRecords,
  listRunRecords,
  readProjectRecord,
  readRunRecord,
  updateProjectRecord,
  updateRunRecord
} from "@/lib/storage/workspace";
import { executeResearchRun } from "@/lib/orchestrator/run-research";
import {
  synthesizeEvidenceFromArtifacts,
  deriveProjectInsightPatch,
  derivePromotionCandidates
} from "@/lib/orchestrator/insights";
import { buildDecision } from "@/lib/orchestrator/decision";
import { buildPrdSeed } from "@/lib/orchestrator/prd-seed";
import { buildDecisionHistory } from "@/lib/orchestrator/decision-history";
import {
  exportRunToObsidian,
  exportInsightsToObsidian,
  exportDecisionHistoryToObsidian
} from "@/lib/export/obsidian";
import { assertRunTransition } from "@/lib/domain/runs";
import type { SourceArtifact, SourcePriority, SourceTarget } from "@/lib/adapters/types";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { WORKSPACE_ROOT } from "@/lib/config";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const command = args[0];

export const AI_FIRST_COMMANDS = [
  "create-project",
  "create-run",
  "run-research",
  "export-run-bundle",
  "execute-external",
  "ingest-advisory",
  "show-run",
  "show-project"
] as const;

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function requireArg(flag: string): string {
  const val = getArg(flag);
  if (!val) {
    console.error(`Missing required argument: ${flag}`);
    process.exit(1);
  }
  return val;
}

type EvidenceInput = {
  title: string;
  url?: string;
  content: string;
  snippet?: string;
  sourceType?: SourceTarget;
  sourcePriority?: SourcePriority;
  publishedAt?: string;
  claims?: Array<{ text: string; stance?: "support" | "oppose" | "neutral"; topicKey?: string }>;
  metadata?: Record<string, string>;
};

async function cmdWriteEvidence() {
  const projectId = requireArg("--project");
  const runId = requireArg("--run");
  const provider = getArg("--provider") ?? "claude";

  const raw = await new Promise<string>((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { buf += chunk; });
    process.stdin.on("end", () => resolve(buf));
  });

  const inputs: EvidenceInput[] = JSON.parse(raw);

  const artifacts: SourceArtifact[] = inputs.map((item, index) => ({
    id: `${provider}-${randomUUID().slice(0, 8)}-${index}`,
    adapter: provider,
    sourceType: item.sourceType ?? "web",
    title: item.title,
    url: item.url ?? "",
    snippet: item.snippet ?? item.content.slice(0, 300),
    content: item.content,
    sourcePriority: item.sourcePriority ?? "analysis",
    publishedAt: item.publishedAt,
    metadata: {
      ...(item.metadata ?? {}),
      ...(item.claims ? { claims_json: JSON.stringify(item.claims) } : {})
    }
  }));

  await updateRunRecord(projectId, runId, (record) => ({
    ...record,
    artifacts: [...record.artifacts, ...artifacts],
    run: { ...record.run, updatedAt: new Date().toISOString() }
  }));

  console.log(`${artifacts.length} artifact(s) written to run ${runId}`);
}

async function cmdSynthesizeRun() {
  const projectId = requireArg("--project");
  const runId = requireArg("--run");
  const now = new Date().toISOString();

  const runRecord = await readRunRecord(projectId, runId);
  const artifacts = runRecord.artifacts;

  if (artifacts.length === 0) {
    console.error("no artifacts found — run write-evidence first");
    process.exit(1);
  }

  const recencySensitive = /(trend|news|latest|최근|트렌드|뉴스)/i.test(
    [runRecord.run.title, runRecord.normalizedInput?.naturalLanguage ?? ""].join(" ")
  );

  // draft → collecting → synthesizing (중간 상태 통과)
  const currentStatus = runRecord.run.status;
  if (currentStatus === "draft") {
    await updateRunRecord(projectId, runId, (r) => ({
      ...r, run: { ...r.run, status: "collecting", updatedAt: now }
    }));
  }
  if (currentStatus === "draft" || currentStatus === "collecting") {
    await updateRunRecord(projectId, runId, (r) => ({
      ...r, run: { ...r.run, status: "synthesizing", updatedAt: now }
    }));
  }

  const synthesis = synthesizeEvidenceFromArtifacts(artifacts, { now, recencySensitive });
  const decision = buildDecision(synthesis, {
    runTitle: runRecord.run.title,
    goal: runRecord.normalizedInput?.goal ?? runRecord.run.title
  });
  const prdSeed = buildPrdSeed(decision, synthesis, {
    runTitle: runRecord.run.title,
    target: runRecord.normalizedInput?.target,
    comparisonAxis: runRecord.normalizedInput?.comparisonAxis
  });

  const finalRecord = await updateRunRecord(projectId, runId, (record) => {
    assertRunTransition(record.run.status, "decided");
    return {
      ...record,
      artifacts: synthesis.artifacts,
      claims: synthesis.claims,
      citations: synthesis.citations,
      contradictions: synthesis.contradictions,
      evidenceSummary: synthesis.summary,
      decision,
      prdSeed,
      run: { ...record.run, status: "decided", updatedAt: now }
    };
  });

  const patch = deriveProjectInsightPatch(synthesis);
  const allRuns = await listRunRecords(projectId);
  const promotionCandidates = derivePromotionCandidates(allRuns);

  const updatedProject = await updateProjectRecord(projectId, (pr) => ({
    ...pr,
    insights: {
      repeatedProblems: [...new Set([...pr.insights.repeatedProblems, ...patch.repeatedProblems])],
      repeatedPatterns: [...new Set([...pr.insights.repeatedPatterns, ...patch.repeatedPatterns])],
      competitorSignals: [...new Set([...pr.insights.competitorSignals, ...patch.competitorSignals])],
      contradictionIds: [...new Set([...pr.insights.contradictionIds, ...patch.contradictionIds])]
    },
    promotionCandidates,
    project: { ...pr.project, updatedAt: now }
  }));

  try {
    const decisionHistory = buildDecisionHistory(updatedProject.project, allRuns);
    await exportRunToObsidian(finalRecord, updatedProject.project);
    await exportInsightsToObsidian(updatedProject.project, updatedProject.insights);
    await exportDecisionHistoryToObsidian(updatedProject.project, decisionHistory);
    console.log("obsidian export done");
  } catch {
    console.error("obsidian export failed (non-fatal)");
  }

  console.log(JSON.stringify({
    status: finalRecord.run.status,
    decision: finalRecord.decision?.value,
    confidence: finalRecord.decision?.confidence,
    why: finalRecord.decision?.why
  }, null, 2));
}

async function cmdExportObsidian() {
  const projectId = requireArg("--project");
  const runId = requireArg("--run");

  const [runRecord, projectRecord, allRuns] = await Promise.all([
    readRunRecord(projectId, runId),
    readProjectRecord(projectId),
    listRunRecords(projectId)
  ]);

  const decisionHistory = buildDecisionHistory(projectRecord.project, allRuns);
  await exportRunToObsidian(runRecord, projectRecord.project);
  await exportInsightsToObsidian(projectRecord.project, projectRecord.insights);
  await exportDecisionHistoryToObsidian(projectRecord.project, decisionHistory);
  console.log("obsidian export done");
}

async function cmdCreateProject() {
  const name = requireArg("--name");
  const description = getArg("--description") ?? "";
  const record = await createProjectRecord({ name, description });
  console.log(JSON.stringify({ id: record.project.id, name: record.project.name }, null, 2));
}

async function cmdCreateRun() {
  const projectId = requireArg("--project");
  const title = requireArg("--title");
  const naturalLanguage = getArg("--query") ?? "";
  const record = await createRunRecord(projectId, { title, naturalLanguage });
  console.log(JSON.stringify({ id: record.run.id, title: record.run.title, status: record.run.status }, null, 2));
}

async function cmdRunResearch() {
  const projectId = requireArg("--project");
  const runId = requireArg("--run");
  console.log(`running research for ${runId}...`);
  const result = await executeResearchRun(projectId, runId);
  console.log(JSON.stringify({
    status: result.run.status,
    decision: result.decision ?? null
  }, null, 2));
}

async function cmdListProjects() {
  const records = await listProjectRecords();
  console.log(JSON.stringify(records.map((r) => ({
    id: r.project.id,
    name: r.project.name,
    updatedAt: r.project.updatedAt
  })), null, 2));
}

async function cmdListRuns() {
  const projectId = requireArg("--project");
  const records = await listRunRecords(projectId);
  console.log(JSON.stringify(records.map((r) => ({
    id: r.run.id,
    title: r.run.title,
    status: r.run.status,
    decision: r.decision?.value ?? null
  })), null, 2));
}

async function cmdShowProject() {
  const projectId = requireArg("--project");
  const [projectRecord, runRecords] = await Promise.all([
    readProjectRecord(projectId),
    listRunRecords(projectId)
  ]);

  console.log(
    JSON.stringify(
      {
        project: projectRecord.project,
        insights: projectRecord.insights,
        promotionCandidates: projectRecord.promotionCandidates,
        runCount: runRecords.length
      },
      null,
      2
    )
  );
}

async function cmdExportRunBundle() {
  const projectId = requireArg("--project");
  const runId = requireArg("--run");
  const dir = await exportRunBundle(projectId, runId);
  console.log(JSON.stringify({ projectId, runId, bundleDir: dir }, null, 2));
}

async function cmdExecuteExternal() {
  const projectId = requireArg("--project");
  const runId = requireArg("--run");
  const provider = (getArg("--provider") ?? "claude") as "claude" | "codex";

  const bundlePath = path.join(WORKSPACE_ROOT, projectId, "runs", runId, "bridge", "bundle.md");
  const bundleMd = await readFile(bundlePath, "utf8");

  const prompt = [
    bundleMd,
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

  const [cmd, ...cmdArgs] =
    provider === "codex"
      ? ["codex", "exec", prompt]
      : ["claude", "-p", "--bare", prompt];

  console.log(`executing ${provider}...`);

  await new Promise<void>((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(cmd, cmdArgs, { stdio: "pipe" });

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("error", reject);
    child.on("close", async (code) => {
      if (code !== 0) {
        console.error(`stderr: ${stderr}`);
        reject(new Error(`process exited with code ${code}`));
        return;
      }

      const advisory = parseCliAdvisoryOutput(stdout);
      await writeAdvisoryResult(projectId, runId, advisory);
      console.log(
        JSON.stringify(
          {
            projectId,
            runId,
            provider,
            advisoryPath: `workspace/${projectId}/runs/${runId}/bridge/advisory.json`
          },
          null,
          2
        )
      );
      resolve();
    });

    child.stdin.end();
  });
}

async function cmdIngestAdvisory() {
  const projectId = requireArg("--project");
  const runId = requireArg("--run");
  const provider = (getArg("--provider") ?? "claude") as "claude" | "codex";

  await ingestAdvisoryFromFile(projectId, runId, provider);
  console.log(JSON.stringify({ projectId, runId, provider, ingested: true }, null, 2));
}

async function cmdShowRun() {
  const projectId = requireArg("--project");
  const runId = requireArg("--run");

  const [projectRecord, runRecord, allRuns] = await Promise.all([
    readProjectRecord(projectId),
    readRunRecord(projectId, runId),
    listRunRecords(projectId)
  ]);

  console.log(JSON.stringify({
    project: { id: projectRecord.project.id, name: projectRecord.project.name },
    run: {
      id: runRecord.run.id,
      title: runRecord.run.title,
      status: runRecord.run.status,
      decision: runRecord.decision ?? null,
      advisory: runRecord.advisory ?? null
    },
    runCount: allRuns.length
  }, null, 2));
}

export function formatUsage(): string {
  return `Usage: pnpm cli <command> [options]

Project:
  create-project      --name <name> [--description <desc>]
  show-project        --project <id>
  list-projects

Run:
  create-run          --project <id> --title <title> [--query <text>]
  list-runs           --project <id>
  run-research        --project <id> --run <id>
  show-run            --project <id> --run <id>

AI-driven research (Claude/Codex as primary actor):
  write-evidence      --project <id> --run <id> [--provider claude|codex]  < stdin JSON
  synthesize-run      --project <id> --run <id>

External advisory:
  export-run-bundle   --project <id> --run <id>
  execute-external    --project <id> --run <id> [--provider claude|codex]
  ingest-advisory     --project <id> --run <id> [--provider claude|codex]
`;
}

export function createCommands(): Record<string, () => Promise<void>> {
  return {
  "create-project": cmdCreateProject,
  "create-run": cmdCreateRun,
  "run-research": cmdRunResearch,
  "show-project": cmdShowProject,
  "list-projects": cmdListProjects,
  "list-runs": cmdListRuns,
  "write-evidence": cmdWriteEvidence,
  "synthesize-run": cmdSynthesizeRun,
  "export-obsidian": cmdExportObsidian,
  "export-run-bundle": cmdExportRunBundle,
  "execute-external": cmdExecuteExternal,
  "ingest-advisory": cmdIngestAdvisory,
  "show-run": cmdShowRun,
  "show-run-state": cmdShowRun
  };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const currentCommand = argv[0];
  const commands = createCommands();

  if (!currentCommand || !(currentCommand in commands)) {
    console.log(formatUsage());
    return currentCommand ? 1 : 0;
  }

  try {
    await commands[currentCommand]();
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exit(code);
  });
}
