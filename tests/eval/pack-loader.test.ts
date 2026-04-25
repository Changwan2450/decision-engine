import path from "node:path";
import { describe, expect, it } from "vitest";
import { PackV1Schema, PackV2DraftSchema } from "@/lib/eval/pack-schema";
import { loadPackV1, loadPackV2Draft } from "@/lib/eval/pack-loader";

const repoRoot = path.resolve(__dirname, "../..");
const pack001Path = path.join(repoRoot, "eval/packs/pack-001.yaml");
const pack002DraftPath = path.join(repoRoot, "eval/packs/pack-002.draft.yaml");

describe("pack loader", () => {
  it("parses pack-001.yaml", () => {
    const pack = loadPackV1(pack001Path);

    expect(pack.packId).toBe("pack-001");
    expect(pack.sealed).toBe(true);
    expect(pack.topicCount).toBe(16);
  });

  it("keeps pack-001 acceptance key set unchanged", () => {
    const pack = loadPackV1(pack001Path);
    const expectedKeys = [
      "allowAbstain",
      "forbiddenSourcePatterns",
      "maxFalseConvergenceSignals",
      "minUsableClaims",
      "requiredSourceClassesAllOf",
      "requiredSourceClassesAnyOf"
    ];

    expect(Object.keys(pack.topics[0].acceptance).sort()).toEqual(expectedKeys);
  });

  it("enforces pack-001 sealed invariants", () => {
    const pack = loadPackV1(pack001Path);

    expect(pack.sealed).toBe(true);
    expect(pack.auditMode).not.toBeNull();
    expect(pack.topicCount).toBe(16);
  });

  it("parses pack-002.draft.yaml", () => {
    const pack = loadPackV2Draft(pack002DraftPath);

    expect(pack.sealed).toBe(false);
    expect(pack.auditMode).toBeNull();
    expect(pack.topicCount).toBe(5);
    expect(pack.cases).toHaveLength(5);
  });

  it("requires all pack-002 acceptance fields", () => {
    const pack = loadPackV2Draft(pack002DraftPath);
    const expectedKeys = [
      "forbidden_source_patterns",
      "min_decisive_evidence_score",
      "n_plus_one_reuse_expected",
      "require_counterevidence_check",
      "require_unresolved_questions_when_weak",
      "required_source_classes"
    ];

    for (const entry of pack.cases) {
      expect(Object.keys(entry.acceptance).sort()).toEqual(expectedKeys);
      expect(entry.acceptance.required_source_classes.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.acceptance.forbidden_source_patterns)).toBe(true);
      expect(typeof entry.acceptance.min_decisive_evidence_score).toBe("number");
      expect(entry.acceptance.min_decisive_evidence_score).toBeGreaterThanOrEqual(0);
      expect(entry.acceptance.min_decisive_evidence_score).toBeLessThanOrEqual(1);
      expect(typeof entry.acceptance.require_counterevidence_check).toBe("boolean");
      expect(typeof entry.acceptance.require_unresolved_questions_when_weak).toBe("boolean");
      expect(typeof entry.acceptance.n_plus_one_reuse_expected).toBe("boolean");
    }
  });

  it("rejects pack-001 when auditMode is null", () => {
    const pack = loadPackV1(pack001Path);

    expect(() =>
      PackV1Schema.parse({
        ...pack,
        sealed: true,
        auditMode: null
      })
    ).toThrow();
  });

  it("rejects pack-002 draft when required_source_classes is missing", () => {
    const pack = loadPackV2Draft(pack002DraftPath);
    const [firstCase, ...rest] = pack.cases;
    const { required_source_classes: _requiredSourceClasses, ...acceptance } =
      firstCase.acceptance;

    expect(() =>
      PackV2DraftSchema.parse({
        ...pack,
        cases: [
          {
            ...firstCase,
            acceptance
          },
          ...rest
        ]
      })
    ).toThrow();
  });
});
