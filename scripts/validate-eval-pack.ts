import path from "node:path";
import { buildEvalPackReport } from "@/lib/eval/pack-report";

function renderList(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join(", ") : "(none)";
}

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: pnpm eval:pack <path-to-pack-yaml>");
  process.exit(1);
}

const report = buildEvalPackReport(path.resolve(inputPath));

if (!report.ok) {
  console.error(`Eval pack invalid: ${inputPath}`);
  console.error(`packId: ${report.packId}`);
  console.error(`kind: ${report.kind}`);
  console.error(`errors: ${report.errors.join("; ") || "(none)"}`);
  process.exit(1);
}

console.log(`Eval pack valid: ${inputPath}`);
console.log(`packId: ${report.packId}`);
console.log(`kind: ${report.kind}`);
console.log(`sealed: ${report.sealed}`);
console.log(`auditMode: ${report.auditMode ?? "null"}`);
console.log(`topicCount: ${report.topicCount}`);
console.log(`caseCount: ${report.caseCount}`);
console.log(`acceptanceFields: ${renderList(report.acceptanceFields)}`);
