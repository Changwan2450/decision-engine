import { mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateFixtureAgainstCase,
  runPack002DryRun,
  type PackV2DraftFixtureBundle
} from "@/lib/eval/pack-dry-run";
import { loadPackV2Draft } from "@/lib/eval/pack-loader";

const repoRoot = path.resolve(__dirname, "../..");
const packPath = path.join(repoRoot, "eval/packs/pack-002.draft.yaml");
const fixturesDir = path.join(repoRoot, "eval/fixtures/pack-002-draft");
const pack = loadPackV2Draft(packPath);
const caseById = new Map(pack.cases.map((entry) => [entry.id, entry]));

function loadFixture(name: string): PackV2DraftFixtureBundle {
  return JSON.parse(
    readFileSync(path.join(fixturesDir, name), "utf8")
  ) as PackV2DraftFixtureBundle;
}

function evaluateFixture(name: string) {
  const fixture = loadFixture(name);
  const packCase = caseById.get(fixture.caseId);
  if (!packCase) throw new Error(`missing case: ${fixture.caseId}`);
  return evaluateFixtureAgainstCase(fixture, packCase);
}

describe("PACK-002 draft dry-run evaluator", () => {
  it("passes p2-01-pass", () => {
    const result = evaluateFixture("p2-01-pass.json");

    expect(result.actualOutcome).toBe("pass");
    expect(result.matched).toBe(true);
  });

  it("detects p2-01 required source class miss", () => {
    const result = evaluateFixture("p2-01-fail.json");

    expect(result.failedChecks).toContain("required-source-class-missing");
  });

  it("detects p2-02 forbidden source pattern hit", () => {
    const result = evaluateFixture("p2-02-fail.json");

    expect(result.failedChecks).toContain("forbidden-source-pattern-hit");
  });

  it("detects p2-03 decisiveness below threshold", () => {
    const result = evaluateFixture("p2-03-fail.json");

    expect(result.failedChecks).toContain("decisiveness-below-threshold");
  });

  it("detects p2-04 missing counterevidence check", () => {
    const result = evaluateFixture("p2-04-fail.json");

    expect(result.failedChecks).toContain("counterevidence-required-but-missing");
  });

  it("passes p2-04 when abstained even without counterevidence", () => {
    const result = evaluateFixture("p2-04-pass.json");

    expect(result.actualOutcome).toBe("pass");
    expect(result.failedChecks).not.toContain("counterevidence-required-but-missing");
  });

  it("requires unresolved questions only when evidence is weak and empty", () => {
    const fixture = loadFixture("p2-04-pass.json");
    const packCase = caseById.get(fixture.caseId)!;

    const notWeak = evaluateFixtureAgainstCase(
      {
        ...fixture,
        bundle: {
          ...fixture.bundle,
          evidenceSummary: {
            ...fixture.bundle.evidenceSummary,
            weakEvidence: false,
            unresolvedQuestions: []
          }
        }
      },
      packCase
    );
    const weakEmpty = evaluateFixtureAgainstCase(
      {
        ...fixture,
        bundle: {
          ...fixture.bundle,
          evidenceSummary: {
            ...fixture.bundle.evidenceSummary,
            weakEvidence: true,
            unresolvedQuestions: []
          }
        }
      },
      packCase
    );

    expect(notWeak.failedChecks).not.toContain("weak-evidence-without-unresolved-questions");
    expect(weakEmpty.failedChecks).toContain("weak-evidence-without-unresolved-questions");
  });

  it("detects p2-05 rejected source refetched", () => {
    const result = evaluateFixture("p2-05-fail-runB.json");

    expect(result.failedChecks).toContain("n-plus-one-rejected-source-refetched");
  });

  it("detects p2-05 unresolved question not carried forward", () => {
    const result = evaluateFixture("p2-05-fail-runB.json");

    expect(result.failedChecks).toContain("n-plus-one-unresolved-not-carried-forward");
  });

  it("passes p2-05 reuse checks", () => {
    const result = evaluateFixture("p2-05-pass-runB.json");

    expect(result.actualOutcome).toBe("pass");
    expect(result.failedChecks).not.toContain("n-plus-one-rejected-source-refetched");
    expect(result.failedChecks).not.toContain("n-plus-one-unresolved-not-carried-forward");
  });

  it("checks forbidden patterns as substrings over host and url", () => {
    const fixture = loadFixture("p2-02-pass.json");
    const packCase = caseById.get(fixture.caseId)!;
    const result = evaluateFixtureAgainstCase(
      {
        ...fixture,
        bundle: {
          ...fixture.bundle,
          artifacts: [
            {
              ...fixture.bundle.artifacts[0],
              url: "https://mirror.example/s.jina.ai-copy",
              host: "mirror.example"
            },
            ...fixture.bundle.artifacts.slice(1)
          ]
        }
      },
      packCase
    );

    expect(result.failedChecks).toContain("forbidden-source-pattern-hit");
  });

  it("requires all required source classes", () => {
    const fixture = loadFixture("p2-05-pass-runB.json");
    const packCase = caseById.get(fixture.caseId)!;
    const result = evaluateFixtureAgainstCase(
      {
        ...fixture,
        bundle: {
          ...fixture.bundle,
          claims: fixture.bundle.claims.filter((claim) => claim.sourceClass !== "community")
        }
      },
      packCase
    );

    expect(result.failedChecks).toContain("required-source-class-missing");
  });

  it("evaluates exactly 11 fixtures with all outcomes matched", () => {
    const report = runPack002DryRun({
      packPath,
      fixturesDir,
      generatedAt: "2026-04-25T00:00:00.000Z"
    });

    expect(report.summary.fixtureCount).toBe(11);
    expect(report.summary.matchedCount).toBe(11);
    expect(report.summary.mismatchedCount).toBe(0);
    expect(report.ok).toBe(true);
  });

  it("marks an intentionally mismatched fixture as unmatched", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "pack-002-dry-run-"));
    const fixture = {
      ...loadFixture("p2-01-pass.json"),
      fixtureId: "p2-01-mismatched",
      expectedOutcome: "fail"
    };
    await writeFile(
      path.join(tempDir, "p2-01-mismatched.json"),
      JSON.stringify(fixture, null, 2),
      "utf8"
    );

    const report = runPack002DryRun({
      packPath,
      fixturesDir: tempDir,
      generatedAt: "2026-04-25T00:00:00.000Z"
    });

    expect(report.results[0].matched).toBe(false);
    expect(report.ok).toBe(false);
  });
});
