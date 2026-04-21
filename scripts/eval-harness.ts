#!/usr/bin/env tsx
import { createProjectRecord, readRunRecord } from "@/lib/storage/workspace";
import { handleMcpRequest } from "@/lib/mcp/server";
import {
  DEFAULT_EVALUATION_CASES,
  evaluateSummary,
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
  const project = await createProjectRecord({
    name: `Evaluation Harness ${Date.now()}`,
    description: "generalization regression harness"
  });
  const projectId = project.project.id;
  const results = [];
  let hasFailure = false;

  for (const testCase of DEFAULT_EVALUATION_CASES) {
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
      summary,
      expected: testCase.expected,
      pass: evaluation.pass,
      failures: evaluation.failures
    });
  }

  process.stdout.write(`${JSON.stringify({ projectId, results }, null, 2)}\n`);
  if (hasFailure) {
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
