import path from "node:path";
import { runPack002DryRun } from "@/lib/eval/pack-dry-run";

const report = runPack002DryRun({
  packPath: path.resolve("eval/packs/pack-002.draft.yaml"),
  fixturesDir: path.resolve("eval/fixtures/pack-002-draft")
});

console.log("PACK-002 draft dry run");
console.log(`packId: ${report.packId}`);
console.log(`packVersion: ${report.packVersion}`);
console.log(`fixtures: ${report.summary.fixtureCount}`);
console.log(`matched: ${report.summary.matchedCount}`);
console.log(`mismatched: ${report.summary.mismatchedCount}`);
console.log(`ok: ${report.ok}`);
console.log(JSON.stringify(report, null, 2));

process.exit(report.ok ? 0 : 1);
