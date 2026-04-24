# Retrieval Robustness Pack v0 Spec

This is the first docs/eval/spec skeleton for Retrieval Robustness Pack v0.
It is intentionally docs-only. It does not change runtime behavior, schemas,
adapters, export bundle shape, or Linkit.

## Product Position

Decision Engine is an AI-friendly headless research engine. Its job is to
help AI agents retrieve, verify, reuse, challenge, and export research state
across runs.

The product surface is an evidence / retrieval / memory layer for agents. It
is not trying to be:

- a tool that answers better than ChatGPT
- a Perplexity-style search UI
- a report generator
- a generic meta-search frontend

The core product value is structured research state: artifacts, claims,
citations, contradictions, provenance, memory, and exportable state that the
next agent run can use.

## Current Retrieval Pipeline Map

Approximate file map. Line numbers are intentionally omitted because this
spec is a planning document, not an edit guide.

- MCP entry: `lib/mcp/server.ts` exposes `run_research`.
- Run planning: `lib/orchestrator/plan-run.ts` `planRun` normalizes input,
  applies seed URLs, and merges query expansion.
- Query expansion: `lib/orchestrator/query-expansion.ts` creates current
  axis-based expansions such as official, recent, comparison, and counter.
- Run execution: `lib/orchestrator/run-research.ts` `executeResearchRun`
  controls collecting, synthesizing, decision, memory update, and retention.
- URL routing: `lib/adapters/router.ts` maps URLs to primary/fallback adapter
  chains.
- Adapter registry: `lib/adapters/registry.ts` wires adapter names to
  adapter implementations.
- Source tiering: `lib/adapters/source-tier.ts` infers source tiers after
  artifacts are gathered.
- Evidence synthesis: `lib/orchestrator/insights.ts` builds citations,
  claims, contradictions, evidence summary, insights, and project memory
  patches.
- Claim inference: `lib/orchestrator/claim-inference.ts` infers stance and
  topic anchors.
- Contradiction kind: `lib/orchestrator/contradiction-kind.ts` classifies
  contradiction tier relationships.
- Decision: `lib/orchestrator/decision.ts` maps evidence summary to
  `go`, `no_go`, or `unclear`.
- Storage: `lib/storage/workspace.ts` reads and writes workspace records.
- Schema: `lib/storage/schema.ts` defines persisted run/project record shape.
- Bundle export: `lib/bridge/cli-file.ts` writes bundle files.
- Bundle shape: `lib/bridge/cli-bundle.ts` defines `CliBridgeBundle`.

## Failure Modes

1. **source-class illusion / blindness**
   The planner can emit "official" query axes without proving that an
   official source class was collected.

2. **aggregator dominance**
   Search mirrors or aggregators can fill the result set and create the
   appearance of independent evidence while hiding weak provenance.

3. **decisiveness blind spot**
   The engine can count relevant claims without distinguishing evidence that
   actually decides the question from evidence that is merely related.

4. **weak contradiction recall / false convergence**
   A plausible answer can converge before contrary evidence, missing source
   classes, or unresolved questions are checked.

5. **N+1 reuse gap**
   Prior useful sources, rejected sources, query variants, citations, and
   unresolved questions are not yet first-class planning inputs for the next
   run.

## V0 Scope

This v0 commit adds only:

- `eval/packs/pack-002.draft.yaml`
- PACK-002 draft acceptance field definitions
- eval-first rule for future retrieval runtime changes
- future insertion points for the implementation phase

PACK-002 is a draft skeleton, not a sealed pack. Its fields may be consumed
by later tests and runtime work, but this commit only fixes the evaluation
contract shape before implementation.

## PACK-002 Draft Acceptance Fields

PACK-002 draft cases define these fields under `acceptance`:

- `required_source_classes`
- `forbidden_source_patterns`
- `min_decisive_evidence_score`
- `require_counterevidence_check`
- `require_unresolved_questions_when_weak`
- `n_plus_one_reuse_expected`

These fields are definitions only in v0. Runtime enforcement is out of scope.

## Out Of Scope

- runtime implementation
- schema migration
- `cli-bridge` `schemaVersion` bump
- Linkit
- UI/report template
- new adapter
- external search API
- PACK-002 sealing
- auditor prompt
- dry-run runner extension
- PACK-001 acceptance or sealed audit rule changes

## Future Insertion Points

Future implementation may touch these files, but this v0 docs-only commit
does not modify them:

- `lib/orchestrator/query-expansion.ts`
- `lib/orchestrator/plan-run.ts`
- `lib/orchestrator/insights.ts`
- `lib/orchestrator/decision.ts`
- `lib/orchestrator/kb-context.ts`
- `lib/storage/schema.ts`

Expected future responsibilities:

- source-class aware query planning in `query-expansion.ts` and `plan-run.ts`
- evidence decisiveness scoring in `insights.ts`
- false convergence guard in `decision.ts`
- N+1 reuse memory in `kb-context.ts` and `schema.ts`

## Ship Blockers

- No runtime retrieval change may ship before PACK-002 draft exists.
- No source-class aware claim may ship without a source-class metric.
- No evidence decisiveness claim may ship without a decisiveness metric.
- No false convergence guard may ship without a false convergence test.
- Existing `export_bundle` keys must not be renamed.
- PACK-001 remains frozen.

## First Commit Boundary

Suggested commit message:

```txt
eval: draft pack-002 + retrieval robustness v0 spec
```

Allowed files for this first commit:

- `docs/RETRIEVAL_ROBUSTNESS_V0_SPEC.md`
- `eval/packs/pack-002.draft.yaml`
- `docs/EVAL_DISCIPLINE.md`

No `lib/` file, Linkit file, runtime file, schema file, or PACK-001 file is
part of this commit.
