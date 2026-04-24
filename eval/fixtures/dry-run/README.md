# PACK-001 Dry-run Fixtures

Synthetic handoff payload used to verify the auditor prompt contract defined
in `docs/PACK_001_SPEC.md` §5 before sealing `eval/packs/pack-001.yaml`.

## Purpose

This dry-run validates that the auditor prompt contract works in either of
the allowed audit modes:

- **self-audit** — same model/runtime family as the research loop
- **external API audit** — pinned API model for deeper independent checks

The invariants below are shared by both modes. The API runner in this folder
tests the optional external-audit path.

1. Parse as strict JSON with no prose before or after
2. Include all four required report fields (`packLevelPassFail`,
   `failureCategoryHistogram`, `anonymizedWorstK`, `auditFooter`)
3. Leak no identifying information (query text, claim text, topic ids,
   artifact URLs) in `anonymizedWorstK`
4. Populate `auditFooter.modelVersionOrDate` with a concrete audit label
   string (not `null` or `"unknown"`). For API audit this should be a pinned
   version/snapshot; for self-audit it may be a concrete local/session label.
5. Produce a `failureCategoryHistogram` that matches the fixture-designed
   failure modes

## Fixture design (4 topics, 1 payload)

| Topic id | Scenario | Expected failure category | Step in §1.4 procedure |
|---|---|---|---|
| `fix-01` | Clean pass — bundle satisfies all acceptance fields | (pass, no entry in histogram) | — |
| `fix-02` | Forbidden source pattern match (`s.jina.ai`) | `authority-substitution` | step 3 |
| `fix-03` | `AllOf: [official-doc]` violated — zero official-doc claims | `retrieval-insufficient` | step 1 |
| `fix-04` | False-convergence — two phrase clusters, `maxFalseConvergenceSignals: 1` | `false-convergence` | step 5 |

Expected pack-level result: **fail** (3 of 4 topics fail).
Expected histogram: `{ "authority-substitution": 1, "retrieval-insufficient": 1, "false-convergence": 1 }`.
Expected `anonymizedWorstK` length: 3 (k=3 per `EVAL_DISCIPLINE.md` §5,
which matches pack-of-8 sealed; dry-run uses the same k).

## Files

- `handoff.json` — the single payload sent to the auditor, per `PACK_001_SPEC.md` §4 format
- `auditor-prompt.md` — the literal prompt template from §5, ready to send
- `run_dryrun.py` — optional Python runner that posts prompt + payload to
  the OpenAI API for deeper audit, or verifies a self-audit raw response via
  `--verify-only`
- `output/` — auditor responses land here (created by runner)
- `../../../docs/PACK_001_DRYRUN_REPORT.md` — report template, filled after run

## Topic ids

Fixture topic ids use the `fix-NN` prefix (not `dev-NN` or `sealed-NN`) to
make it unambiguous these are dry-run fixtures, never PACK-001 topics.

## Invariants under test

- **Anonymization**: `anonymizedWorstK` must not contain any substring from
  `fix-01` / `fix-02` / `fix-03` / `fix-04` topic ids, query text, claim
  text, or artifact URLs. A grep check in the report verifies this.
- **Strict JSON**: the full response text must be parseable by
  `json.loads()` with no surrounding prose. The runner asserts this.
- **Histogram sum**: `sum(failureCategoryHistogram.values())` must equal
  the number of failing topics (here: 3), and each category must be one of
  the 7 defined in `EVAL_DISCIPLINE.md` §7.
- **Audit label footer**: `auditFooter.modelVersionOrDate` must be a
  non-empty concrete string, not `null`, not `"unknown"`, not `"latest"`.

If any invariant fails, the runner exits non-zero and the seal for
`eval/packs/pack-001.yaml` does not proceed until the auditor prompt in
§5 is corrected.
