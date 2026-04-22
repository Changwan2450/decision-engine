#!/usr/bin/env tsx
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createProjectRecord, readRunRecord } from "@/lib/storage/workspace";
import { handleMcpRequest } from "@/lib/mcp/server";
import {
  buildSearchContractSummary,
  DEFAULT_EVALUATED_RUN_SAMPLES,
  DEFAULT_EVALUATION_CASES,
  evaluateSummary,
  renderEvaluationMarkdownReport,
  summarizeEvaluatedRunSamples,
  summarizeEvaluationResults,
  summarizeEvaluationRun,
  type EvaluationCaseResult,
  type EvaluationHarnessReport
} from "@/lib/orchestrator/evaluation-harness";

async function callTool(name: string, args: Record<string, unknown>) {
  const response = (await handleMcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args }
  })) as { result?: { structuredContent?: any } };
  return response.result?.structuredContent;
}

function parseArgs(argv: string[]) {
  const requestedCaseIds = new Set<string>();
  let outPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--case" && argv[index + 1]) {
      requestedCaseIds.add(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--case=")) {
      requestedCaseIds.add(arg.slice("--case=".length));
      continue;
    }
    if (arg === "--out" && argv[index + 1]) {
      outPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      outPath = arg.slice("--out=".length);
    }
  }

  return { requestedCaseIds, outPath };
}

async function buildReport(): Promise<EvaluationHarnessReport> {
  const { requestedCaseIds } = parseArgs(process.argv.slice(2));
  const cases =
    requestedCaseIds.size > 0
      ? DEFAULT_EVALUATION_CASES.filter((entry) => requestedCaseIds.has(entry.id))
      : DEFAULT_EVALUATION_CASES;
  if (cases.length === 0) {
    throw new Error("No evaluation cases matched the requested --case filters.");
  }

  const project = await createProjectRecord({
    name: `Evaluation Report ${Date.now()}`,
    description: "operator-visible evaluation report"
  });
  const projectId = project.project.id;
  const results: EvaluationCaseResult[] = [];

  for (const testCase of cases) {
    let run = await callTool("run_research", {
      projectId,
      title: testCase.title
    });

    if (run?.run?.status === "awaiting_clarification") {
      run = await callTool("clarify_run", {
        projectId,
        runId: run.run.id,
        query: testCase.query
      });
    }

    const record = await readRunRecord(projectId, run.run.id);
    const summary = summarizeEvaluationRun(record);
    const evaluation = evaluateSummary(summary, testCase.expected);
    results.push({
      id: testCase.id,
      runType: testCase.runType,
      tags: testCase.tags,
      summary,
      expected: testCase.expected,
      pass: evaluation.pass,
      failures: evaluation.failures
    });
  }

  return {
    projectId,
    searchContract: buildSearchContractSummary(),
    summary: summarizeEvaluationResults(results),
    evaluatedSamples: summarizeEvaluatedRunSamples(
      cases,
      DEFAULT_EVALUATED_RUN_SAMPLES.filter((sample) =>
        cases.some((entry) => entry.id === sample.caseId)
      )
    ),
    results
  };
}

async function main() {
  const { outPath } = parseArgs(process.argv.slice(2));
  const report = await buildReport();
  const markdown = renderEvaluationMarkdownReport(report);

  if (outPath) {
    const resolved = resolve(outPath);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, markdown, "utf8");
    process.stdout.write(`${resolved}\n`);
    return;
  }

  process.stdout.write(markdown);
  if (!markdown.endsWith("\n")) {
    process.stdout.write("\n");
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
