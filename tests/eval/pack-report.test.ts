import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildEvalPackReport } from "@/lib/eval/pack-report";

const repoRoot = path.resolve(__dirname, "../..");
const pack001Path = path.join(repoRoot, "eval/packs/pack-001.yaml");
const pack002DraftPath = path.join(repoRoot, "eval/packs/pack-002.draft.yaml");

describe("buildEvalPackReport", () => {
  it("reports pack-001", () => {
    const report = buildEvalPackReport(pack001Path);

    expect(report.ok).toBe(true);
    expect(report.kind).toBe("pack-v1");
    expect(report.sealed).toBe(true);
    expect(report.topicCount).toBe(16);
  });

  it("reports pack-002 draft", () => {
    const report = buildEvalPackReport(pack002DraftPath);

    expect(report.ok).toBe(true);
    expect(report.kind).toBe("pack-v2-draft");
    expect(report.sealed).toBe(false);
    expect(report.topicCount).toBe(5);
    expect(report.caseCount).toBe(5);
    expect(report.acceptanceFields).toEqual(
      expect.arrayContaining([
        "required_source_classes",
        "forbidden_source_patterns",
        "min_decisive_evidence_score",
        "require_counterevidence_check",
        "require_unresolved_questions_when_weak",
        "n_plus_one_reuse_expected"
      ])
    );
  });

  it("returns an invalid report for a missing path", () => {
    const report = buildEvalPackReport(path.join(repoRoot, "eval/packs/missing.yaml"));

    expect(report.ok).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it("returns an invalid report for an unknown pack shape", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "pack-report-"));
    const packPath = path.join(tempDir, "unknown.yaml");
    await writeFile(packPath, "packId: pack-999\n", "utf8");

    const report = buildEvalPackReport(packPath);

    expect(report.ok).toBe(false);
    expect(report.packId).toBe("pack-999");
    expect(report.errors[0]).toContain("unknown packId");
  });
});
