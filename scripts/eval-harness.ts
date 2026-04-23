#!/usr/bin/env tsx
import { createProjectRecord, readRunRecord } from "@/lib/storage/workspace";
import { handleMcpRequest } from "@/lib/mcp/server";
import {
  AVAILABLE_EVALUATION_CASES,
  buildSearchContractSummary,
  DEFAULT_EVALUATED_RUN_SAMPLES,
  DEFAULT_EVALUATION_CASES,
  evaluateSummary,
  summarizeEvaluatedRunSamples,
  summarizeEvaluationResults,
  summarizeEvaluationRun
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

async function main() {
  const requestedCaseIds = new Set(
    process.argv.flatMap((arg, index, args) => {
      if (arg === "--case") {
        return args[index + 1] ? [args[index + 1]] : [];
      }
      if (arg.startsWith("--case=")) {
        return [arg.slice("--case=".length)];
      }
      return [];
    })
  );
  const cases =
    requestedCaseIds.size > 0
      ? AVAILABLE_EVALUATION_CASES.filter((entry) => requestedCaseIds.has(entry.id))
      : DEFAULT_EVALUATION_CASES;
  if (cases.length === 0) {
    process.stderr.write("No evaluation cases matched the requested --case filters.\n");
    process.exit(1);
  }
  const project = await createProjectRecord({
    name: `Evaluation Harness ${Date.now()}`,
    description: "generalization regression harness"
  });
  const projectId = project.project.id;
  const results = [];
  let hasFailure = false;

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
    hasFailure = hasFailure || !evaluation.pass;
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

  const report = summarizeEvaluationResults(results);
  const evaluatedSamples = summarizeEvaluatedRunSamples(
    cases,
    DEFAULT_EVALUATED_RUN_SAMPLES.filter((sample) =>
      cases.some((entry) => entry.id === sample.caseId)
    )
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        projectId,
        searchContract: buildSearchContractSummary(),
        summary: report,
        evaluatedSamples,
        results
      },
      null,
      2
    )}\n`
  );
  if (hasFailure) {
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
