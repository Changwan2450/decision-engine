import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_ROOT } from "@/lib/config";
import { buildCliBundle, renderCliBundleMarkdown, type CliBridgeProvider } from "@/lib/bridge/cli-bundle";
import { ingestCliAdvisoryResult, type CliAdvisoryInput } from "@/lib/bridge/cli-ingest";
import { buildDecisionHistory } from "@/lib/orchestrator/decision-history";
import {
  listRunRecords,
  readProjectRecord,
  readRunRecord,
  updateRunRecord
} from "@/lib/storage/workspace";

function bridgeDir(projectId: string, runId: string): string {
  return path.join(WORKSPACE_ROOT, projectId, "runs", runId, "bridge");
}

function runStateFile(projectId: string, runId: string): string {
  return path.join(bridgeDir(projectId, runId), "run-state.json");
}

function eventsFile(projectId: string, runId: string): string {
  return path.join(bridgeDir(projectId, runId), "events.jsonl");
}

export async function appendRunEvent(
  projectId: string,
  runId: string,
  event: {
    type: string;
    detail: Record<string, unknown>;
    at?: string;
  }
): Promise<string> {
  const filePath = eventsFile(projectId, runId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(
    filePath,
    `${JSON.stringify({
      type: event.type,
      detail: event.detail,
      at: event.at ?? new Date().toISOString()
    })}\n`
  );
  return filePath;
}

export async function writeRunStateSnapshot(
  projectId: string,
  runId: string
): Promise<string> {
  const runRecord = await readRunRecord(projectId, runId);
  const snapshot = {
    projectId,
    runId,
    status: runRecord.run.status,
    updatedAt: runRecord.run.updatedAt,
    decision: runRecord.decision
      ? {
          value: runRecord.decision.value,
          confidence: runRecord.decision.confidence
        }
      : null,
    artifactCount: runRecord.artifacts.length,
    advisoryStatus: runRecord.advisory ? "available" : "none"
  };

  const filePath = runStateFile(projectId, runId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(snapshot, null, 2));
  await appendRunEvent(projectId, runId, {
    type: "run_state_written",
    detail: {
      status: snapshot.status,
      advisoryStatus: snapshot.advisoryStatus,
      artifactCount: snapshot.artifactCount
    }
  });
  return filePath;
}

export async function exportRunBundle(projectId: string, runId: string): Promise<string> {
  const [projectRecord, runRecord, allRuns] = await Promise.all([
    readProjectRecord(projectId),
    readRunRecord(projectId, runId),
    listRunRecords(projectId)
  ]);

  const decisionHistory = buildDecisionHistory(projectRecord.project, allRuns);
  const relatedRuns = allRuns
    .filter((record) => record.run.id !== runId && !!record.decision)
    .sort((left, right) => right.run.createdAt.localeCompare(left.run.createdAt))
    .slice(0, 3)
    .map((record) => ({
      runId: record.run.id,
      title: record.run.title,
      decision: record.decision!.value,
      why: record.decision!.why,
      createdAt: record.run.createdAt
    }));
  const decisionHistorySummary = [...decisionHistory]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5)
    .map((item) => {
      const match = allRuns.find((record) => record.run.id === item.runId);
      return {
        runId: item.runId,
        title: match?.run.title ?? item.runId,
        decision: item.decision,
        createdAt: item.createdAt
      };
    });
  const recentContradictions = allRuns
    .slice()
    .sort((left, right) => right.run.createdAt.localeCompare(left.run.createdAt))
    .flatMap((record) =>
      record.contradictions.map((contradiction) => ({
        runId: record.run.id,
        contradictionId: contradiction.id,
        status: contradiction.status,
        resolution: contradiction.resolution
      }))
    )
    .slice(0, 3);
  const projectInsightSummary = {
    repeatedProblems: projectRecord.insights.repeatedProblems.join(" / ") || undefined,
    solutionPatterns: projectRecord.insights.repeatedPatterns.join(" / ") || undefined,
    competitorSignals: projectRecord.insights.competitorSignals.join(" / ") || undefined,
    conflicts: projectRecord.insights.contradictionIds.join(" / ") || undefined
  };
  const bundle = buildCliBundle({
    project: projectRecord.project,
    latestRun: runRecord,
    insights: projectRecord.insights,
    decisionHistory,
    relatedRuns,
    promotionCandidates: projectRecord.promotionCandidates,
    decisionHistorySummary,
    recentContradictions,
    projectInsightSummary,
    bridgeConfig: { provider: "claude", mode: "cli_execute" }
  });

  const dir = bridgeDir(projectId, runId);
  await mkdir(dir, { recursive: true });

  await Promise.all([
    writeFile(path.join(dir, "bundle.json"), JSON.stringify(bundle, null, 2)),
    writeFile(path.join(dir, "bundle.md"), renderCliBundleMarkdown(bundle))
  ]);
  await writeRunStateSnapshot(projectId, runId);
  await appendRunEvent(projectId, runId, {
    type: "bundle_exported",
    detail: {
      provider: bundle.bridge.provider,
      mode: bundle.bridge.mode
    }
  });

  return dir;
}

export async function readAdvisoryResult(projectId: string, runId: string): Promise<CliAdvisoryInput> {
  const filePath = path.join(bridgeDir(projectId, runId), "advisory.json");
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as CliAdvisoryInput;
}

export async function writeAdvisoryResult(
  projectId: string,
  runId: string,
  result: CliAdvisoryInput
): Promise<void> {
  const dir = bridgeDir(projectId, runId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "advisory.json"), JSON.stringify(result, null, 2));
  await writeRunStateSnapshot(projectId, runId);
  await appendRunEvent(projectId, runId, {
    type: "advisory_written",
    detail: {
      hasSummary: Boolean(result.external_summary),
      nextActionCount: result.suggested_next_actions?.length ?? 0,
      notesCount: result.notes?.length ?? 0
    }
  });
}

export async function ingestAdvisoryFromFile(
  projectId: string,
  runId: string,
  provider: CliBridgeProvider
): Promise<void> {
  const advisory = await readAdvisoryResult(projectId, runId);
  await updateRunRecord(projectId, runId, (record) =>
    ingestCliAdvisoryResult(record, advisory, {
      provider,
      mode: "cli_execute",
      ingestedAt: new Date().toISOString(),
      success: true
    })
  );
  await writeRunStateSnapshot(projectId, runId);
  await appendRunEvent(projectId, runId, {
    type: "advisory_ingested",
    detail: {
      provider,
      success: true
    }
  });
}
