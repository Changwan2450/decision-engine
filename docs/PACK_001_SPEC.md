# PACK-001 Specification

First concrete evaluation pack under the discipline defined in
`docs/EVAL_DISCIPLINE.md`. This document proposes:

- the acceptance-criteria schema every topic carries
- the axis distribution matrix for the 16 topics (8 DEV-OBSERVED + 8
  SEALED-AUDIT)
- the 16 topic proposals (query + axis coordinates + acceptance values)
- the local-runner → auditor handoff format
- the seal-timing protocol

This is a proposal document. Once reviewed and approved, its contents are
transcribed to `eval/packs/pack-001.yaml` and the pack is considered sealed.
Edits after seal follow `EVAL_DISCIPLINE.md` §6 and §8.

## 1. Acceptance schema

Every topic in the pack carries an `acceptance` object. The fields are
fixed; fields cannot be added, removed, or relaxed after the pack is
sealed.

```yaml
acceptance:
  requiredSourceClassesAnyOf: [string]      # at least one claim from any listed class
  requiredSourceClassesAllOf: [string]      # every listed class MUST appear; use sparingly
  forbiddenSourcePatterns: [string]         # substring or hostname match rules
  minUsableClaims: integer                  # distinctive, non-stub claims required
  maxFalseConvergenceSignals: integer       # §7 false-convergence flags tolerated
  allowAbstain: boolean                     # true if "insufficient evidence" is an acceptable pass
```

The split between `AnyOf` and `AllOf` exists because treating every listed
class as strictly required turns the pack into a "source-compliance audit"
rather than a retrieval-quality eval. Most topics can be answered well from
two or three classes; `AllOf` is reserved for topics where a specific
class is structurally required (e.g. `official-doc` for a version-migration
question where vendor schemas are non-negotiable).

### Canonical source-class mapping

The local runner tags each claim with exactly one class. The auditor
trusts these tags. Implementation of the tagger belongs to the harness
spec, but the canonical class definitions live here so acceptance is
closed:

- `official-doc` — vendor, framework, or project official documentation
  (not product marketing). Examples: python.org docs, rustc book,
  react.dev, PostgreSQL manual.
- `product-doc` — vendor product docs, pricing pages, feature pages,
  changelogs attached to commercial products. Examples: vercel.com/docs,
  cloudflare.com/products.
- `experience-report` — personal or team retrospective, incident report,
  migration write-up, "we ran X in production" narrative. Single-author
  voice with concrete operational detail.
- `community` — forum / HN / Reddit / discussion-board posts and
  threads. Multi-voice, short-form.
- `blog` — analysis article, comparison, explainer, or opinion piece
  that is not clearly a personal retrospective. Editorial in tone.
- `academic` — paper, preprint, conference proceedings, or research
  note. Peer-reviewed or arXiv-style.

A claim that cannot be unambiguously classified is tagged as the
closest-matching class and flagged for review; if more than 10% of a
bundle's claims are review-flagged, the local runner MUST refine the
tagging before handoff.

### Field semantics

- `requiredSourceClassesAnyOf` — the auditor passes this check if the
  bundle contains at least one claim in any one of the listed classes.
  This is the default soft requirement; most topics should use only
  this.
- `requiredSourceClassesAllOf` — the auditor fails the topic with
  `retrieval-insufficient` if any listed class has zero claims in the
  bundle. Use only when a class is structurally required for the
  question to be meaningfully answered.
- `forbiddenSourcePatterns` — the auditor fails a topic with
  `authority-substitution` if any claim's source matches these patterns.
  Used to block known-bad hosts (`s.jina.ai`, authentication-wall URLs)
  and to prevent spurious passes on sources that should have been
  filtered upstream.
- `minUsableClaims` — distinct, non-stub, topic-anchored claims required.
  Stubs (URL-derived titles, 401 error bodies, empty normalizations) do
  not count, regardless of `stance`.
- `maxFalseConvergenceSignals` — the auditor marks a `false-convergence`
  signal when multiple claims share substantial phrase/meme overlap across
  sources. The exact detection rule is deferred to the false-convergence
  metric spec; for PACK-001 the auditor uses judgment and records one
  signal per identifiable cluster.
- `allowAbstain` — if `true`, the auditor may pass the topic on the basis
  that the engine correctly refused to synthesize despite insufficient
  evidence. If `false`, abstention is a failure (`retrieval-insufficient`
  category per §7).

### Auditor computation

Given bundle `B` and acceptance `A`, the auditor evaluates:

1. If `A.requiredSourceClassesAllOf` is non-empty: for each class `c` in
   that list, is there at least one claim in `B` tagged as `c`? If any
   class is missing → `retrieval-insufficient` failure.
2. If `A.requiredSourceClassesAnyOf` is non-empty: does the bundle
   contain at least one claim tagged as any class in that list? If none
   match → `retrieval-insufficient` failure.
3. For each claim `k` in `B`, does its source match any pattern in
   `A.forbiddenSourcePatterns`? If yes → `authority-substitution` failure.
4. Count distinct, usable claims in `B`. If less than `A.minUsableClaims`
   → `retrieval-insufficient` failure (unless `A.allowAbstain` and the
   engine produced an explicit abstention note, in which case pass).
5. Count false-convergence signal clusters. If more than
   `A.maxFalseConvergenceSignals` → `false-convergence` failure.
6. Check for schema violations or cost overruns (categories
   `schema-violation`, `cost-overrun`).

A topic passes iff none of the above trigger a failure category.

## 2. Axis distribution

The 16 topics cover the 5 axes defined in `EVAL_DISCIPLINE.md` §3. Each
topic carries exactly one value on each axis. The DEV/SEALED split is
stratified so each half carries a similar cross-section.

### Per-axis distribution across all 16 topics

| Axis | Value | Count | DEV | SEALED |
|---|---|---|---|---|
| `language` | `en` | 9 | 4 | 5 |
| `language` | `ko` | 4 | 2 | 2 |
| `language` | `mixed` | 3 | 2 | 1 |
| `genre` | `official-rich` | 3 | 1 | 2 |
| `genre` | `official-sparse` | 4 | 2 | 2 |
| `genre` | `experience-only` | 9 | 5 | 4 |
| `recency` | `static` | 4 | 2 | 2 |
| `recency` | `recent-6mo` | 12 | 6 | 6 |
| `disputedness` | `consensual` | 5 | 3 | 2 |
| `disputedness` | `disputed` | 11 | 5 | 6 |
| `doc-density` | `dense` | 5 | 2 | 3 |
| `doc-density` | `sparse` | 11 | 6 | 5 |

Each half carries at least one `en`, `ko`, and `mixed` topic, satisfying
the language-stratification rule.

### Risk-zone coverage

The pack deliberately overweights regions where the failure modes from
the eval review are most likely. These counts overlap — a topic can
populate more than one risk zone.

| Risk zone | Axis signature | Topics covering | Failure mode targeted |
|---|---|---|---|
| Experience-only sparse docs | `genre: experience-only` AND `doc-density: sparse` | 9 | false convergence, authority substitution |
| Recent + hype surface | `genre: experience-only` AND `recency: recent-6mo` | 7 | false convergence (meme replication) |
| Disputed sparse authority | `genre: official-sparse` AND `disputedness: disputed` | 3 | false balance, authority substitution |
| Control: fresh + authoritative | `genre: official-rich` AND `recency: recent-6mo` | 2 | baseline — should pass cleanly |
| Sanity slot | `official-rich + static + consensual + dense` | 1 (sealed-08) | smoke check — failure here is systemic |

The sanity slot has exactly one topic. Any failure on that topic is a
signal to stop and audit the pipeline, not to adjust retrieval policy.

## 3. Proposed topic list

Every proposal carries:
- `id` — stable short identifier
- `query` — exact submission string
- `axes` — 5 coordinates
- `acceptance` — per schema in §1
- `rationale` — one-line reason this topic is in the pack

Queries are proposals. Replace any topic the reviewer finds unsuitable,
but preserve the axis coordinate of the slot so the matrix remains
intact.

### DEV-OBSERVED (8)

```yaml
- id: dev-01
  query: "Zig vs Rust for systems programming without a borrow checker — is the tradeoff real?"
  axes: { language: en, genre: experience-only, recency: recent-6mo, disputedness: disputed, doc-density: sparse }
  acceptance:
    requiredSourceClassesAnyOf: [experience-report, community, blog]
    requiredSourceClassesAllOf: []
    forbiddenSourcePatterns: ["s.jina.ai", "login.required"]
    minUsableClaims: 6
    maxFalseConvergenceSignals: 2
    allowAbstain: false
  rationale: "Recent-6mo + experience-only + disputed — false convergence likely from repeated reddit memes."

- id: dev-02
  query: "3~10인 규모 한국 개발팀이 Node.js 외 JS 런타임 (Deno, Bun 등) 으로 이전한 실무 회고 — 고려 요인과 후회 지점"
  axes: { language: ko, genre: experience-only, recency: recent-6mo, disputedness: disputed, doc-density: sparse }
  acceptance:
    requiredSourceClassesAnyOf: [experience-report, blog, community]
    requiredSourceClassesAllOf: []
    forbiddenSourcePatterns: ["s.jina.ai"]
    minUsableClaims: 5
    maxFalseConvergenceSignals: 1
    allowAbstain: true
  rationale: "ko + experience-only retrospective, broadened from single-runtime framing so the answer does not depend on one hype cycle."

- id: dev-03
  query: "Service Mesh (Istio, Linkerd) latency overhead in production — measured vs claimed"
  axes: { language: en, genre: official-sparse, recency: static, disputedness: disputed, doc-density: dense }
  acceptance:
    requiredSourceClassesAnyOf: [blog, experience-report, community]
    requiredSourceClassesAllOf: []
    forbiddenSourcePatterns: ["s.jina.ai", "paywall"]
    minUsableClaims: 7
    maxFalseConvergenceSignals: 2
    allowAbstain: false
  rationale: "Static + disputed + dense — false balance test (vendor claims vs operator experience)."

- id: dev-04
  query: "FastAPI를 대규모 서비스로 운영할 때의 현실적 운영 비용과 한계"
  axes: { language: mixed, genre: experience-only, recency: static, disputedness: consensual, doc-density: sparse }
  acceptance:
    requiredSourceClassesAnyOf: [experience-report, blog, community]
    requiredSourceClassesAllOf: []
    forbiddenSourcePatterns: ["s.jina.ai"]
    minUsableClaims: 5
    maxFalseConvergenceSignals: 1
    allowAbstain: true
  rationale: "Mixed-language consensual — baseline for convergence calibration."

- id: dev-05
  query: "PostgreSQL 18 uuidv7 migration strategy for existing uuid columns"
  axes: { language: en, genre: official-sparse, recency: recent-6mo, disputedness: consensual, doc-density: sparse }
  acceptance:
    requiredSourceClassesAnyOf: [community, blog, experience-report]
    requiredSourceClassesAllOf: [official-doc]
    forbiddenSourcePatterns: ["s.jina.ai"]
    minUsableClaims: 4
    maxFalseConvergenceSignals: 0
    allowAbstain: false
  rationale: "Fresh migration — official PostgreSQL docs are structurally required for the schema/typing answer; corroborating class is optional."

- id: dev-06
  query: "React Server Components in production — what breaks and what doesn't (2025)"
  axes: { language: en, genre: experience-only, recency: recent-6mo, disputedness: disputed, doc-density: sparse }
  acceptance:
    requiredSourceClassesAnyOf: [experience-report, community, blog]
    requiredSourceClassesAllOf: []
    forbiddenSourcePatterns: ["s.jina.ai"]
    minUsableClaims: 7
    maxFalseConvergenceSignals: 3
    allowAbstain: false
  rationale: "Recent + disputed + hype-heavy — highest false-convergence risk in the pack."

- id: dev-07
  query: "Rust async runtime 선택: tokio vs smol 2025 기준 실무 권고"
  axes: { language: mixed, genre: official-rich, recency: recent-6mo, disputedness: consensual, doc-density: dense }
  acceptance:
    requiredSourceClassesAnyOf: [community, blog, experience-report]
    requiredSourceClassesAllOf: [official-doc]
    forbiddenSourcePatterns: ["s.jina.ai"]
    minUsableClaims: 6
    maxFalseConvergenceSignals: 1
    allowAbstain: false
  rationale: "Fresh + official-rich — tokio/smol official docs are the anchor; community practice fills in."

- id: dev-08
  query: "Claude Code와 Cursor의 실무 비교 — 누가 어디서 더 나은가"
  axes: { language: ko, genre: experience-only, recency: recent-6mo, disputedness: disputed, doc-density: sparse }
  acceptance:
    requiredSourceClassesAnyOf: [experience-report, blog, community]
    requiredSourceClassesAllOf: []
    forbiddenSourcePatterns: ["s.jina.ai"]
    minUsableClaims: 5
    maxFalseConvergenceSignals: 2
    allowAbstain: true
  rationale: "ko + very recent + hype — tests false convergence in Korean dev community. Only AI-tooling topic in the pack (SEALED half carries no AI-tooling counterpart, per axis-balance rule)."
```

### SEALED-AUDIT (8)

Queries below become sealed the moment this pack moves to the yaml file.
The policy author MAY re-read these queries (they are not secret), but the
policy author MUST NOT see the bundle contents for any of these topics.

```yaml
- id: sealed-01
  query: "Monorepo tooling (Nx, Turborepo) for 3-person teams — worth the overhead?"
  axes: { language: en, genre: experience-only, recency: static, disputedness: disputed, doc-density: sparse }
  acceptance:
    requiredSourceClassesAnyOf: [experience-report, community, blog]
    requiredSourceClassesAllOf: []
    forbiddenSourcePatterns: ["s.jina.ai"]
    minUsableClaims: 6
    maxFalseConvergenceSignals: 2
    allowAbstain: false
  rationale: "Static + disputed + sparse — tests false balance on small-team tradeoffs."

- id: sealed-02
  query: "LangGraph를 프로덕션 agent 파이프라인에 도입한 실제 경험"
  axes: { language: ko, genre: experience-only, recency: recent-6mo, disputedness: disputed, doc-density: sparse }
  acceptance:
    requiredSourceClassesAnyOf: [experience-report, blog, community]
    requiredSourceClassesAllOf: []
    forbiddenSourcePatterns: ["s.jina.ai"]
    minUsableClaims: 4
    maxFalseConvergenceSignals: 1
    allowAbstain: true
  rationale: "ko + very sparse — authority substitution test."

- id: sealed-03
  query: "Cloudflare Workers vs AWS Lambda reliability and cold-start in 2025"
  axes: { language: en, genre: official-sparse, recency: recent-6mo, disputedness: disputed, doc-density: dense }
  acceptance:
    requiredSourceClassesAnyOf: [blog, experience-report, community, official-doc, product-doc]
    requiredSourceClassesAllOf: []
    forbiddenSourcePatterns: ["s.jina.ai"]
    minUsableClaims: 7
    maxFalseConvergenceSignals: 2
    allowAbstain: false
  rationale: "Fresh + disputed + dense — false balance between vendor docs and operator reports."

- id: sealed-04
  query: "SvelteKit으로의 전환이 React 팀에 실제로 이득인가 — 2025 기준"
  axes: { language: mixed, genre: experience-only, recency: recent-6mo, disputedness: disputed, doc-density: sparse }
  acceptance:
    requiredSourceClassesAnyOf: [experience-report, community, blog]
    requiredSourceClassesAllOf: []
    forbiddenSourcePatterns: ["s.jina.ai"]
    minUsableClaims: 5
    maxFalseConvergenceSignals: 2
    allowAbstain: true
  rationale: "Mixed + recent + hype-adjacent — convergence-prone."

- id: sealed-05
  query: "Python 3.13 free-threading (GIL-less) — practical impact for real workloads"
  axes: { language: en, genre: official-rich, recency: recent-6mo, disputedness: consensual, doc-density: dense }
  acceptance:
    requiredSourceClassesAnyOf: [blog, experience-report, community]
    requiredSourceClassesAllOf: [official-doc]
    forbiddenSourcePatterns: ["s.jina.ai"]
    minUsableClaims: 6
    maxFalseConvergenceSignals: 1
    allowAbstain: false
  rationale: "Fresh + official-rich — official CPython docs are the anchor for threading-model claims."

- id: sealed-06
  query: "Runtime validation 2025: Zod vs ArkType vs Valibot — decision criteria"
  axes: { language: en, genre: official-sparse, recency: recent-6mo, disputedness: disputed, doc-density: sparse }
  acceptance:
    requiredSourceClassesAnyOf: [experience-report, community, official-doc, blog]
    requiredSourceClassesAllOf: []
    forbiddenSourcePatterns: ["s.jina.ai"]
    minUsableClaims: 6
    maxFalseConvergenceSignals: 2
    allowAbstain: false
  rationale: "Fresh + disputed + sparse — false convergence risk across JS validator benchmarks."

- id: sealed-07
  query: "Bun 1.x를 Node.js 대체로 프로덕션에 도입한 팀의 실무 경험과 한계 (2025)"
  axes: { language: ko, genre: experience-only, recency: recent-6mo, disputedness: disputed, doc-density: sparse }
  acceptance:
    requiredSourceClassesAnyOf: [experience-report, blog, community]
    requiredSourceClassesAllOf: []
    forbiddenSourcePatterns: ["s.jina.ai"]
    minUsableClaims: 5
    maxFalseConvergenceSignals: 2
    allowAbstain: true
  rationale: "Replaces earlier vibe-coding draft. Same axes (ko + experience-only + recent + disputed + sparse) but outside AI-tooling meme cluster; tests a different sparse/disputed surface."

- id: sealed-08
  query: "Kubernetes resource requests vs limits — what they do and how to set them correctly"
  axes: { language: en, genre: official-rich, recency: static, disputedness: consensual, doc-density: dense }
  acceptance:
    requiredSourceClassesAnyOf: []
    requiredSourceClassesAllOf: [official-doc]
    forbiddenSourcePatterns: ["s.jina.ai"]
    minUsableClaims: 7
    maxFalseConvergenceSignals: 1
    allowAbstain: false
  rationale: "Replaces Twelve-Factor draft. Genuinely consensual — established K8s best-practice zone. K8s official docs are the anchor and the only hard requirement; unofficial corroboration is welcome but not forced. Sanity slot must not impose source-mix constraints beyond the one structurally required class. Any failure here indicates a systemic retrieval or synthesis issue, which is what the sanity slot is meant to catch."
```

## 4. Local-runner handoff format

The local runner produces a handoff payload per audit cycle. The payload
is a single JSON file with the structure below. This file is transmitted
to the external auditor and contains everything the auditor needs.

```json
{
  "packId": "pack-001",
  "packVersion": "1.0.0",
  "half": "SEALED-AUDIT",
  "engineBuild": {
    "commit": "<git sha>",
    "timestamp": "<ISO 8601>"
  },
  "topics": [
    {
      "id": "sealed-01",
      "query": "<verbatim query>",
      "axes": { "language": "en", "genre": "experience-only", ... },
      "acceptance": { ...schema per §1... },
      "bundle": {
        "artifacts": [ ... engine artifacts ... ],
        "claims": [ ... engine claims ... ],
        "contradictions": [ ... engine contradictions ... ],
        "runMetadata": { "runId": "...", "durationMs": ..., "retrievalBudgetUsed": ... }
      }
    }
  ]
}
```

The runner MUST:
- Include all 8 SEALED-AUDIT topics in one payload (auditor judges them as
  a set, not per-topic, to enable histogram + worst-k shape outputs).
- Include raw bundle content — no pre-judgment, no pre-filtering.
- NOT include any DEV-OBSERVED bundles (keeps the audit surface narrow).
- NOT include the retrieval-policy source code, PR diff, or engine
  internals.

The handoff file is transmitted via whatever channel the chosen audit mode
supports. For `external API audit`, this may be file upload to a GPT-5 API
message. For `self-audit`, this may be a local/manual prompt handoff to the
default research model/runtime. The channel is a harness detail, not a
contract detail.

## 5. Auditor prompt template

The prompt template sent to the auditor alongside the handoff payload
is fixed by this spec. Changes to the prompt require a new PACK version.

```
You are the SEALED-AUDIT auditor for evaluation pack {packId} (version
{packVersion}).

You will be given 8 research-engine output bundles, each with a query,
axis coordinates, and acceptance criteria. Your job is to judge whether
each bundle satisfies its acceptance criteria, classify failures into
the provided categories, and return ONLY the aggregate report defined
below. You MUST NOT return per-topic pass/fail, query text, claim text,
artifact URLs, topic ids, or any information that would let the
requester identify which specific topic failed.

Acceptance evaluation procedure: [reproduced from §1.4]

Failure categories: [reproduced from EVAL_DISCIPLINE §7]

Report schema:
{
  "packLevelPassFail": "pass" | "fail",
  "failureCategoryHistogram": { "<category>": <count>, ... },
  "anonymizedWorstK": [
    {
      "failureCategory": "<category>",
      "axisCoordinates": { "language": "...", "genre": "...", ... }
    }
  ],
  "auditFooter": {
    "provider": "<audit provider>",
    "model": "<model string you are running under>",
    "modelVersionOrDate": "<pinned version or concrete self-audit label>",
    "auditTimestamp": "<ISO 8601>"
  }
}

Return only this JSON. No prose before or after.
```

The worst-k list MUST be shuffled before return so its order does not
correspond to PACK position. The auditor is instructed to not include
any free-text rationale. `auditFooter.modelVersionOrDate` must be a
concrete audit label string; `"latest"`, `"unknown"`, `null`, or an
empty string are not acceptable.

## 6. Seal timing

The pack becomes sealed at the moment `eval/packs/pack-001.yaml` is
committed. Before that commit:

- The pack spec (this document) may be edited freely.
- Queries may be swapped. Axis coordinates may be adjusted.
- Acceptance values may be calibrated.

After the commit:

- Queries are frozen. Changes require seal-break accounting per
  `EVAL_DISCIPLINE.md` §6.
- Acceptance values MUST NOT be relaxed. They MAY be tightened (making
  the pack harder) but not loosened.
- The entire pack is subject to the retirement rules in
  `EVAL_DISCIPLINE.md` §8.

Until the first audit cycle runs, the SEALED-AUDIT half is effectively
"staged but never observed." The seal activates fully on the first audit.

## 7. Open questions

- **Source classification — implementation.** The canonical class
  definitions now live in §1 so acceptance is fully closed. What
  remains open is how the local runner actually implements the tagger:
  domain allow-lists, URL-pattern heuristics, adapter-level labels
  emitted by each retrieval source, or a combination. That
  implementation choice is deferred to the harness spec. Tagger
  correctness is auditable via the 10%-review-flag rule in §1.

- **False-convergence detection.** The auditor currently uses judgment.
  A deterministic metric is deferred (`EVAL_DISCIPLINE.md` §10).
  First-audit false-convergence counts will establish the baseline the
  metric spec must match.

- **Topic replacement suggestions.** Some of the 16 proposals lean
  toward the `en` language; reviewer may want to rebalance toward
  `ko`/`mixed` for higher topical relevance to the project. The axis
  distribution matrix is the constraint; specific queries are
  negotiable.

- **Acceptance calibration.** `minUsableClaims` and
  `maxFalseConvergenceSignals` values are first-pass estimates. Under
  §6, post-seal values may be tightened but never relaxed within
  PACK-001. If the first audit cycle shows the values are too strict
  (i.e. they need to be loosened), the correction ships as PACK-002
  with a fresh SEALED-AUDIT half — not as an in-pack adjustment. This
  keeps §6 and §7 aligned: PACK-001 has exactly one acceptance
  configuration for its lifetime, and miscalibration is resolved by
  versioning, not by patching.
