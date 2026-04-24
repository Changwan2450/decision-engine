# PACK-001 Auditor Prompt Dry-run Report

Dry-run validation of the auditor prompt template defined in
`docs/PACK_001_SPEC.md` §5. Precondition to sealing
`eval/packs/pack-001.yaml`.

**Status:** PASS (self-audit verify-only path executed)

---

## 1. Purpose

Verify the auditor prompt contract produces responses that satisfy the five
invariants in `eval/fixtures/dry-run/README.md`.

This report may be filled from either:

- **self-audit** output from the default research/runtime model, or
- **external API audit** output from a pinned API model

1. Strict JSON (no surrounding prose, no markdown fences)
2. Four required report fields present
3. No identifying information leaks in `anonymizedWorstK`
4. `auditFooter.modelVersionOrDate` is a concrete audit label string
5. `failureCategoryHistogram` matches the fixture-designed failure modes

## 2. Fixture summary

One handoff payload with four topics:

| Topic id | Scenario | Expected failure | Expected step (§1.4) |
|---|---|---|---|
| `fix-01` | Clean pass | (none) | — |
| `fix-02` | Forbidden source pattern | `authority-substitution` | step 3 |
| `fix-03` | `AllOf: [official-doc]` missing | `retrieval-insufficient` | step 1 |
| `fix-04` | Two phrase clusters, max 1 allowed | `false-convergence` | step 5 |

Expected aggregate:

- `packLevelPassFail = "fail"`
- `failureCategoryHistogram = { "authority-substitution": 1, "retrieval-insufficient": 1, "false-convergence": 1 }`
- `anonymizedWorstK` length = 3

## 3. Execution

Command:
```
cd eval/fixtures/dry-run
export OPENAI_API_KEY=sk-...
export OPENAI_MODEL=gpt-5-<pinned-snapshot>
python3 run_dryrun.py
```

The API runner exits 0 only if every invariant passes. Any non-zero exit code
blocks the seal. If self-audit is used instead, record the same four pieces of
evidence manually: raw response, parsed JSON, audit label, and invariant
outcome. The recommended path is:

```
python3 run_dryrun.py --verify-only output/audit-output-raw-<stamp>.txt
```

### Run log

- **Timestamp (UTC):** `2026-04-24T05:07:01Z`
- **Mode:** `self-audit`
- **Model requested:** N/A (`--verify-only`)
- **Model returned (footer.model):** `codex`
- **modelVersionOrDate:** `codex-self-audit-2026-04-24`
- **API latency (ms):** N/A (`--verify-only`)
- **Raw response byte count:** 1037
- **Command:** `python3 run_dryrun.py --verify-only output/audit-output-raw-self-20260424T050701Z.txt`

## 4. Invariant results

| # | Invariant | Result | Evidence |
|---|---|---|---|
| 1 | Strict JSON | PASS | `run_dryrun.py` exited `0`; parsed file `output/audit-output-verified-20260424T050717Z.json` |
| 2 | Required fields | PASS | `packLevelPassFail`, `failureCategoryHistogram`, `anonymizedWorstK`, `auditFooter` all present |
| 3 | No info leak | PASS | `validate_no_leaks` passed; no topic id/query/claim/artifact URL leakage |
| 4 | Concrete audit label | PASS | `auditFooter.modelVersionOrDate = "codex-self-audit-2026-04-24"` |
| 5 | Expected histogram | PASS | histogram exactly `{authority-substitution:1, retrieval-insufficient:1, false-convergence:1}` and `worstK.len = 3` |

## 5. Parsed auditor response

_Filled after run. Paste the contents of `output/audit-output-*.json` below:_

```json
{
  "packLevelPassFail": "fail",
  "failureCategoryHistogram": {
    "authority-substitution": 1,
    "retrieval-insufficient": 1,
    "false-convergence": 1
  },
  "anonymizedWorstK": [
    {
      "failureCategory": "false-convergence",
      "axisCoordinates": {
        "language": "en",
        "genre": "experience-only",
        "recency": "recent-6mo",
        "disputedness": "disputed",
        "doc-density": "sparse"
      }
    },
    {
      "failureCategory": "authority-substitution",
      "axisCoordinates": {
        "language": "en",
        "genre": "experience-only",
        "recency": "recent-6mo",
        "disputedness": "disputed",
        "doc-density": "sparse"
      }
    },
    {
      "failureCategory": "retrieval-insufficient",
      "axisCoordinates": {
        "language": "en",
        "genre": "official-sparse",
        "recency": "static",
        "disputedness": "consensual",
        "doc-density": "sparse"
      }
    }
  ],
  "auditFooter": {
    "provider": "self-audit",
    "model": "codex",
    "modelVersionOrDate": "codex-self-audit-2026-04-24",
    "auditTimestamp": "2026-04-24T05:07:01Z"
  }
}
```

## 6. Findings

Issues discovered during dry-run — the whole point of running this before
seal. Each finding is either a prompt-template bug (fix in
`docs/PACK_001_SPEC.md` §5 or `eval/fixtures/dry-run/auditor-prompt.md`)
or an invariant-design bug (fix in `run_dryrun.py` / this report).

### Known-in-advance findings

- **§5 template hard-codes "8 research-engine output bundles".** This
  fixture uses 4 bundles, so the dry-run prompt substitutes "4". The
  sealed pack will always be exactly 8 (per `EVAL_DISCIPLINE.md` §4), so
  hard-coding is technically correct for the sealed case — but the
  template should probably be parameterized on `topicCount` to keep
  dry-run and future non-8 packs (e.g. PACK-002 if size changes) valid
  under the same prompt contract. Decision deferred until after this
  dry-run confirms the 8-hard-coded version works end-to-end.

### Observed findings

- No prompt-contract failure found in self-audit verify-only mode.
- `anonymizedWorstK` exact-length guard (`len == 3`) behaved as intended.
- Self-audit path now has the same invariant gate as API mode; default mode is
  not looser than optional API audit.

## 7. Decision

- **If all 5 invariants pass:** auditor prompt contract is ready. Proceed
  to transcribe `docs/PACK_001_SPEC.md` contents to `eval/packs/pack-001.yaml`.
  Close task #77. Return focus to task #76.
- **If any invariant fails:** fix the prompt template or the spec, update
  the affected section, re-run this dry-run. Do not seal the yaml.
- **If the API call fails for infrastructure reasons** (auth, quota,
  network): this is not a prompt-contract failure. Resolve separately and
  re-run, or switch to self-audit mode if deeper external audit is not
  required for this cycle.

## 8. Follow-ups

- [ ] Decide whether `PACK_001_SPEC.md` §5 template should parameterize
  bundle count (`{topicCount}`) or remain hard-coded to 8.
- [ ] Record first-audit baseline values of `modelVersionOrDate` in
  `EVAL_DISCIPLINE.md` §11 (auditor identity lock confirmation).
- [ ] If external independence is needed later, run the same fixture through
  the optional API-audit path and compare against this self-audit baseline.
- [ ] Calibrate worst-k. Current value: 3 (matches sealed pack-of-8
  default). If the auditor consistently returns fewer than 3 entries even
  when ≥ 3 failures exist, investigate prompt wording.
