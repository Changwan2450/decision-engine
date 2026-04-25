import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadPackV2Draft } from "@/lib/eval/pack-loader";
import type { PackV2Draft } from "@/lib/eval/pack-schema";

type PackV2DraftCase = PackV2Draft["cases"][number];
type PackV2DraftCaseAcceptance = PackV2DraftCase["acceptance"];

export type PackV2DraftFixtureBundle = {
  fixtureId: string;
  caseId: string;
  expectedOutcome: "pass" | "fail";
  expectedFailureReason?: string;
  bundle: {
    artifacts: Array<{
      id: string;
      url: string;
      host: string;
      sourceClass: string;
      title?: string;
    }>;
    claims: Array<{
      id: string;
      artifactId: string;
      text: string;
      sourceClass: string;
      stance: string;
      decisiveness: number;
    }>;
    evidenceSummary: {
      decisiveEvidenceScore: number;
      counterevidenceChecked: boolean;
      unresolvedQuestions: string[];
      abstained: boolean;
      weakEvidence: boolean;
    };
    runMetadata: {
      runId: string;
      isRepeatRun: boolean;
    };
    priorRunRef?: string;
    reuse?: {
      rejectedSourcesFromPrior: string[];
      rejectedSourcesReFetched: string[];
      unresolvedQuestionsCarriedForward: boolean;
      usefulPriorSourcesReused: string[];
    };
  };
};

export type DryRunCheck =
  | "required-source-class-missing"
  | "forbidden-source-pattern-hit"
  | "decisiveness-below-threshold"
  | "counterevidence-required-but-missing"
  | "weak-evidence-without-unresolved-questions"
  | "n-plus-one-rejected-source-refetched"
  | "n-plus-one-unresolved-not-carried-forward";

export type PackV2DraftFixtureResult = {
  fixtureId: string;
  caseId: string;
  expectedOutcome: "pass" | "fail";
  actualOutcome: "pass" | "fail";
  matched: boolean;
  failedChecks: DryRunCheck[];
};

export type PackV2DraftDryRunReport = {
  packId: string;
  packVersion: string;
  generatedAt: string;
  results: PackV2DraftFixtureResult[];
  summary: {
    fixtureCount: number;
    matchedCount: number;
    mismatchedCount: number;
    perCheckHistogram: Record<DryRunCheck, number>;
  };
  ok: boolean;
};

const CHECKS: DryRunCheck[] = [
  "required-source-class-missing",
  "forbidden-source-pattern-hit",
  "decisiveness-below-threshold",
  "counterevidence-required-but-missing",
  "weak-evidence-without-unresolved-questions",
  "n-plus-one-rejected-source-refetched",
  "n-plus-one-unresolved-not-carried-forward"
];

function emptyHistogram(): Record<DryRunCheck, number> {
  return Object.fromEntries(CHECKS.map((check) => [check, 0])) as Record<DryRunCheck, number>;
}

function matchesForbiddenPattern(value: string, pattern: string): boolean {
  return value.includes(pattern);
}

export function evaluateFixtureAgainstCase(
  fixture: PackV2DraftFixtureBundle,
  packCase: Pick<PackV2DraftCase, "id" | "acceptance">
): PackV2DraftFixtureResult {
  const acceptance: PackV2DraftCaseAcceptance = packCase.acceptance;
  const failedChecks: DryRunCheck[] = [];
  const claimSourceClasses = new Set(fixture.bundle.claims.map((claim) => claim.sourceClass));

  for (const sourceClass of acceptance.required_source_classes) {
    if (!claimSourceClasses.has(sourceClass)) {
      failedChecks.push("required-source-class-missing");
      break;
    }
  }

  const forbiddenHit = fixture.bundle.artifacts.some((artifact) =>
    acceptance.forbidden_source_patterns.some(
      (pattern) =>
        matchesForbiddenPattern(artifact.url, pattern) ||
        matchesForbiddenPattern(artifact.host, pattern)
    )
  );
  if (forbiddenHit) {
    failedChecks.push("forbidden-source-pattern-hit");
  }

  if (
    fixture.bundle.evidenceSummary.decisiveEvidenceScore <
    acceptance.min_decisive_evidence_score
  ) {
    failedChecks.push("decisiveness-below-threshold");
  }

  if (
    acceptance.require_counterevidence_check &&
    fixture.bundle.evidenceSummary.counterevidenceChecked !== true &&
    fixture.bundle.evidenceSummary.abstained !== true
  ) {
    failedChecks.push("counterevidence-required-but-missing");
  }

  if (
    acceptance.require_unresolved_questions_when_weak &&
    fixture.bundle.evidenceSummary.weakEvidence === true &&
    fixture.bundle.evidenceSummary.unresolvedQuestions.length === 0
  ) {
    failedChecks.push("weak-evidence-without-unresolved-questions");
  }

  if (
    acceptance.n_plus_one_reuse_expected &&
    fixture.bundle.runMetadata.isRepeatRun === true
  ) {
    if ((fixture.bundle.reuse?.rejectedSourcesReFetched.length ?? 0) > 0) {
      failedChecks.push("n-plus-one-rejected-source-refetched");
    }
    if (fixture.bundle.reuse?.unresolvedQuestionsCarriedForward !== true) {
      failedChecks.push("n-plus-one-unresolved-not-carried-forward");
    }
  }

  const actualOutcome = failedChecks.length === 0 ? "pass" : "fail";
  return {
    fixtureId: fixture.fixtureId,
    caseId: fixture.caseId,
    expectedOutcome: fixture.expectedOutcome,
    actualOutcome,
    matched: fixture.expectedOutcome === actualOutcome,
    failedChecks
  };
}

function readFixtures(fixturesDir: string): PackV2DraftFixtureBundle[] {
  return readdirSync(fixturesDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .map((fileName) => {
      const fullPath = path.join(fixturesDir, fileName);
      return JSON.parse(readFileSync(fullPath, "utf8")) as PackV2DraftFixtureBundle;
    });
}

export function runPack002DryRun(params: {
  packPath: string;
  fixturesDir: string;
  generatedAt?: string;
}): PackV2DraftDryRunReport {
  const pack = loadPackV2Draft(params.packPath);
  const caseById = new Map(pack.cases.map((entry) => [entry.id, entry]));
  const fixtures = readFixtures(params.fixturesDir);
  const results = fixtures.map((fixture) => {
    const packCase = caseById.get(fixture.caseId);
    if (!packCase) {
      return {
        fixtureId: fixture.fixtureId,
        caseId: fixture.caseId,
        expectedOutcome: fixture.expectedOutcome,
        actualOutcome: "fail" as const,
        matched: fixture.expectedOutcome === "fail",
        failedChecks: ["required-source-class-missing" as const]
      };
    }
    return evaluateFixtureAgainstCase(fixture, packCase);
  });

  const perCheckHistogram = emptyHistogram();
  for (const result of results) {
    for (const check of result.failedChecks) {
      perCheckHistogram[check] += 1;
    }
  }

  const matchedCount = results.filter((result) => result.matched).length;
  const mismatchedCount = results.length - matchedCount;

  return {
    packId: pack.packId,
    packVersion: pack.packVersion,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    results,
    summary: {
      fixtureCount: results.length,
      matchedCount,
      mismatchedCount,
      perCheckHistogram
    },
    ok: mismatchedCount === 0
  };
}
