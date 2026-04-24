# Evaluation Discipline

Canonical contract for how the research engine is evaluated against real queries.
This document exists because the prior evaluation setup — two recurring
"holdout" cases — had silently degraded into a development set, and the
evaluation signal became indistinguishable from tuning feedback.

This document defines what an honest eval looks like going forward and locks
down the operational rules that keep that honesty in place.

It does not describe algorithms, policies, or code. Those are free to evolve.
The rules below govern how we know whether that evolution is real progress.

## 0. Why this exists

Until now, Rust-vs-Go and monorepo-vs-polyrepo were treated as holdouts.
In practice, policy changes (community gating, official seed, sourcePriority,
search signal corrections) were made after observing the behavior of these
two cases. That makes them a **development set**, not a holdout.

Any pass on that set is evidence that *tuning worked*, not evidence that the
engine generalizes. We will not make more retrieval-policy changes on top of
that confusion.

This document is the instrument that prevents the confusion from returning.

## 1. Terminology lockdown

The word **holdout** is now reserved. It refers only to cases that have never
been observed at topic-level detail by the policy author (현재 solo operator).

The following terms are now canonical and MUST be used consistently in code,
commits, specs, and conversation:

- **DEV-2**
  The two legacy cases (Rust-vs-Go, monorepo-vs-polyrepo). These are a
  development set. They MAY continue to be used for local debugging and
  regression sanity. They MUST NOT be referred to as a holdout.

- **DEV-OBSERVED**
  The development half of the current evaluation pack. Results are visible to
  the policy author. Retrieval-policy changes are allowed while looking at this
  half.

- **SEALED-AUDIT**
  The audit half of the current evaluation pack. Topic-level raw results are
  NOT visible to the policy author. Only aggregated reports and failure
  categories reach the policy author (see §5).

- **PACK**
  A versioned bundle of evaluation topics with axis assignments and per-topic
  acceptance criteria. Packs are immutable once sealed (see §6).

Any usage of "holdout" that does not refer to SEALED-AUDIT is a regression of
this discipline and should be corrected immediately.

## 2. Operational model

The evaluation follows a **B + C hybrid model**:

- Split discipline (Model B): each PACK is divided into DEV-OBSERVED and
  SEALED-AUDIT halves before any result is inspected.
- External auditor discipline (Model C): the SEALED-AUDIT half is executed
  by an external auditor (a separate AI or a human reviewer with no access to
  the current retrieval policy code under review). Only aggregated outputs
  reach the policy author.

Rationale for this hybrid: solo operation makes policy-author / eval-runner
separation impossible by default. Model B alone relies on self-discipline to
avoid peeking, which is the failure mode this document was written to prevent.
Model C alone blocks the fast development loop because no per-case debugging
is possible. The hybrid keeps the loop while preserving at least half of the
pack as real generalization evidence.

Audit execution has two allowed modes:

- **self-audit** — default mode. The same runtime/model family that powers
  day-to-day research may judge the SEALED-AUDIT payload, as long as the
  reporting contract in §5 is respected.
- **external API audit** — optional deeper mode. A separate API-backed
  auditor with a pinned model string may be used when stronger
  independence, reproducibility, or milestone-grade evidence is required.

## 3. Topic selection axes

Every topic in a PACK MUST carry explicit coordinates on the following axes.
A PACK is rejected if its axis matrix is degenerate (e.g. all topics
official-rich + consensual).

- `language`: `en` | `ko` | `mixed`
- `genre`: `official-rich` | `official-sparse` | `experience-only`
- `recency`: `static` | `recent-6mo`
- `disputedness`: `consensual` | `disputed`
- `doc-density`: `dense` | `sparse`

PACKs MUST overweight the combinations that the current system is least tested
on: `official-sparse` + `experience-only`, `recent-6mo`, and `disputed +
official-sparse`. These are the failure-prone regions identified in the eval
review (authority substitution failure, false convergence, false balance).

A PACK SHOULD NOT spend more than one slot on `official-rich + static +
consensual + dense` combinations. That quadrant is a sanity check, not an
evaluation.

## 4. Pack composition

A PACK contains exactly **16 topics**, divided into two halves of equal size:

- 8 topics → DEV-OBSERVED
- 8 topics → SEALED-AUDIT

Size 16 is fixed (not a range). Smaller packs do not leave enough axis room
for the risky-combination overweighting required in §3; larger packs raise
audit cost without adding evaluative signal. Changes to this size are a
revision of this document, not a per-pack choice.

The split MUST be stratified across the axes above — the two halves MUST
cover the axis space similarly, so SEALED-AUDIT results can be compared
fairly against DEV-OBSERVED results.

Each topic carries:

- `id` — short stable identifier
- `query` — the exact query string that will be submitted to the engine
- `axes` — the five axis coordinates
- `acceptance` — per-topic pass criteria, written in the PACK file BEFORE
  any run is executed. Examples: minimum distinctive claim count,
  forbidden source list, required source categories, allowed drift bounds.
  Acceptance criteria MUST be stated at PACK-creation time and cannot be
  relaxed after observing results.
- `half` — `DEV-OBSERVED` or `SEALED-AUDIT`

The actual topic list for the first pack lives in a separate file
(`eval/packs/pack-001.yaml` or equivalent) and is out of scope for this
document. The PACK file is the source of truth for what is in each half.

## 5. Auditor protocol (SEALED-AUDIT)

SEALED-AUDIT is split across two distinct roles. This split is part of the
contract, not a harness implementation detail. Putting it here prevents the
harness spec from silently re-merging the roles.

**Local runner** (runs on the policy author's environment):

- Executes each SEALED-AUDIT query against the current engine build.
- Captures the raw bundle (artifacts, claims, contradictions, run metadata)
  for each topic.
- Attaches the per-topic `axes` and `acceptance` fields from the PACK file
  to each bundle.
- Transmits the assembled bundles + criteria + axes to the external
  auditor.
- MUST NOT inspect bundle contents topic-by-topic before handoff. Necessary
  smoke checks (e.g. "engine did not crash", "all 8 runs produced a
  bundle") are permitted; reading per-topic claim content, stance
  distributions, or contradiction text is not.

**Auditor**:

- Receives only the bundles + acceptance criteria + axis coordinates.
- Makes per-topic pass/fail and failure-category judgments by reading the
  bundle content against the acceptance criteria.
- Returns ONLY the aggregate report defined below — never the per-topic
  judgments themselves.

Audit-mode-specific isolation requirements:

- **external API audit**
  - Runs on a separate environment the policy author does not control.
  - Has no access to the engine codebase, retrieval-policy code, PR under
    review, or any execution environment.
- **self-audit**
  - MUST run in a **fresh invocation context** that is not a continuation of
    the retrieval session that produced the bundles.
  - The fresh context MUST receive only the sanctioned handoff payload
    (bundles + acceptance + axes) and MUST NOT receive retrieval-session
    notes, prior topic-level observations, or debugging commentary.
  - Reusing a retrieval conversation/thread as the audit context is forbidden,
    because it collapses the logical seal even if no external API is used.

The current default is **self-audit**. `GPT-5 via API with a pinned model
version string` is an optional deeper-audit path, not a mandatory default.
See §11 for the decision record and rotation constraints.

### Auditor inputs

- The raw bundles (one per SEALED-AUDIT topic, containing
  artifacts/claims/contradictions/run-metadata)
- The SEALED-AUDIT half of the PACK (queries, axes, acceptance criteria)

### Auditor outputs

The auditor returns ONLY the aggregate report below. Per-topic pass/fail is
explicitly forbidden from the report, because the policy author knows the
query list and can trivially reconstruct which topic failed from any
positional or ordinal signal. Partial leakage of identity collapses the
seal.

The audit report contains exactly:

- **pack-level pass/fail** — binary, whether the pack as a whole met its
  aggregate acceptance threshold.
- **failure-category histogram** — counts across the categories in §7
  (e.g. `{authority-substitution: 2, false-convergence: 1, ...}`), with no
  ordering that corresponds to topic position in the PACK.
- **anonymized worst-k failure shapes** — for the k worst-performing topics
  (k = 3 for a pack of 8 sealed), a short failure description in the form
  "`<failure-category>` on a `<axis-coordinates>` topic", stripped of
  query content and with randomized order that does NOT map to PACK
  position.
- **audit report footer** — MUST include `provider`, `model`,
  `model_version_or_date`, and `audit_timestamp`. This is the auditor
  identity record required by §11.

The auditor MUST NOT include any of the following in the report: the query
text, raw claims, artifact URLs, topic ids, ordered per-topic results, or
any other signal that lets the policy author identify which specific topic
failed.

The policy author MUST NOT request or read anything beyond the above. If the
policy author receives or reads any forbidden field for any topic, the
affected topics are immediately promoted to DEV-OBSERVED per §6 and new
sealed topics MUST be drafted before the next retrieval-policy change.

## 6. Seal-break protocol

Any of the following actions constitute a **seal break** for a topic:

- Reading any field of an audit report that §5 forbids (per-topic
  pass/fail, ordered results, query text, artifact URLs, etc.), whether
  through an auditor mistake, inference from ordering, or any side channel.
- Reading topic-level raw output (claims, artifacts, search results) from
  a SEALED-AUDIT topic through any route other than the sanctioned audit
  report.
- Making a retrieval-policy change targeted at a specific SEALED-AUDIT
  topic whose identity became known to the policy author through any
  means. Targeted means the change would not have been motivated by
  DEV-OBSERVED results alone.
- Copying a SEALED-AUDIT query into a local debug run.

When a seal break occurs:

1. The affected topic is immediately reclassified as DEV-OBSERVED.
2. A replacement topic MUST be drafted and added to SEALED-AUDIT before the
   next retrieval-policy PR lands.
3. The PACK version is bumped and the change is recorded in the PACK
   changelog.

Seal breaks are not failures of the process; they are expected during hard
debugging. The discipline is in acknowledging them and paying the cost
(drafting a replacement) rather than pretending they didn't happen.

## 7. Failure categories

The auditor classifies each SEALED-AUDIT failure into one of:

- `retrieval-insufficient` — no relevant sources surfaced
- `authority-substitution` — low-authority source trusted as if authoritative
- `false-convergence` — multiple outputs agree because they share source/meme
  lineage, not because of independent evidence
- `false-balance` — framing disagreement mistaken for substantive
  contradiction, or vice versa
- `schema-violation` — artifact/claim structure broke the expected schema
- `cost-overrun` — run exceeded the declared retrieval budget
- `other` — with a one-line free-text note

These categories exist to make the failure distribution legible without
exposing topic details. They also connect directly to the missing defenses
identified in the eval review.

## 8. Pack renewal

A PACK is retired and replaced when any of the following holds:

- More than 2 of its 8 SEALED-AUDIT topics have been seal-broken.
- Major architectural change (new retrieval layer, new storage model) has
  landed since the PACK was sealed.
- More than 3 months have elapsed since the PACK was sealed.

Retirement means the entire PACK is moved into DEV-OBSERVED status. A new
PACK with fresh SEALED-AUDIT topics MUST be sealed before the next
retrieval-policy PR lands.

Multiple retired PACKs can be combined into a single growing DEV-OBSERVED
corpus, but no topic ever returns to SEALED-AUDIT status once broken.

## 9. What this replaces

- DEV-2 (Rust-vs-Go, monorepo-vs-polyrepo) is no longer a holdout under any
  name. It remains a useful local regression set; it MUST NOT be cited as
  generalization evidence.
- The previous informal practice of "running the two cases after each PR" is
  replaced by the PACK discipline above. The two cases MAY continue to be
  run as a pre-PR smoke check, but their result is not admissible as
  evidence of progress.

## 10. Deferred / out of scope

The following are intentionally NOT defined in this document and will be
spec'd separately:

- The first PACK's actual 16 topics (8 DEV-OBSERVED + 8 SEALED-AUDIT) and
  per-topic acceptance criteria (→ `eval/packs/pack-001.yaml`).
- The execution harness (CLI, report format, auditor handoff mechanics)
  (→ separate harness spec).
- N+1 determinism contract for the engine (→ separate cost/reuse spec).
- False-convergence detection metric (→ separate metric spec).
- Measurable differentiation targets vs named competitors
  (→ separate differentiation spec).

These are tracked as the downstream items that unblock retrieval-policy work
again. No retrieval-policy change is admissible until at least PACK-001 and
the harness exist.

## 11. Open questions

- **Auditor identity — LOCKED per PACK once chosen.** Each PACK must declare
  whether it is using `self-audit` or `external API audit`, and must keep that
  choice fixed for the life of the PACK. Every audit report footer MUST carry
  `provider`, `model`, `model_version_or_date`, and `audit_timestamp`
  (see §5). For external API audit, `model_version_or_date` should be a
  pinned snapshot string. For self-audit, it may be a concrete
  runtime/session label. Rotation strategy (adding a human reviewer or a
  second AI assistant to reduce auditor-specific bias) is deferred — it does
  not unblock any current work. Auditor MUST NOT be changed mid-PACK; a
  different auditor requires a new PACK.

  **PACK-001 baseline**
  - `mode`: `self-audit`
  - `provider`: `self-audit`
  - `model`: `codex`
  - `model_version_or_date`: `codex-self-audit-2026-04-24`
  - `audit_timestamp`: `2026-04-24T05:07:01Z`
- **Audit frequency**. Per-PR audit is too expensive; end-of-batch audit is
  too loose. Provisional rule: audit once per N PRs with a declared N, N ≤ 3.
  The tight bound reflects that retrieval policy is still moving fast; any
  blind window longer than a handful of PRs risks compounding regressions
  before the next audit. To be revisited after the first three audit cycles.
- **Auditor tooling drift**. If the auditor AI changes underlying model, past
  audit results may no longer be comparable. Provisional mitigation: record
  auditor identity + version in each audit report.
- **Axis expansion — ambiguity**. The current 5 axes do not capture query
  ambiguity (low vs high disambiguation load). This is likely the next axis
  to add because ambiguity-driven failures are a more immediate risk than
  query-length variation. Deferred until PACK-002 so PACK-001 can lock a
  stable axis schema.
