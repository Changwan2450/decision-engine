# Demo

This demo shows how Decision Engine turns a research topic into an evidence-state packet with an Operator Brief.

Demo topic:

> How should research agents prevent false convergence and source over-reliance?

## Primary Demo: Source Coverage Repair Success

Sample files:

- `examples/operator-brief-source-coverage/bundle.md`
- `examples/operator-brief-source-coverage/bundle.json`

Expected traits:

- `repairAttempts.sourceCoverage.outcome: followed_evidence`
- `candidateCount: 17`
- `allowedUrlCount: 5`
- `followedEvidenceCount: 3`
- `hasOfficialOrPrimaryEvidence: true`
- `falseConvergenceRisk: false`
- `operatorBrief.confidenceStatus: usable_with_caution`

Inspect in `bundle.md`:

- `## Operator Brief`
- `## Evidence Diagnostics`
- `## Repair Attempts`
- `## Evidence Replay`

Inspect in `bundle.json`:

- `operatorBrief`
- `evidenceDiagnostics`
- `repairAttempts.sourceCoverage`
- `repairAttempts.counterevidence`
- `evidenceReplay.sourceQualitySummary`

## Secondary Demo: Honest Failed Discovery

Sample files:

- `examples/operator-brief-counterevidence-failed/bundle.md`
- `examples/operator-brief-counterevidence-failed/bundle.json`

Expected traits:

- `repairAttempts.counterevidence.outcome: failed_discovery`
- discovery errors include `search_results_unavailable` and `http_status_202`
- `falseConvergenceRisk: true`
- `counterevidenceChecked: false`
- `hasOfficialOrPrimaryEvidence: false`
- `operatorBrief.confidenceStatus: not_ready`

This sample is intentionally not a success case. It demonstrates that discovery failures are visible and are not overclaimed as evidence.

## Reproduction Flow

The main AI-facing path is MCP:

```text
run_research
  -> if awaiting_clarification, clarify_run
  -> if decided, export_bundle
```

The CLI export path is:

```bash
pnpm cli export-run-bundle --project <projectId> --run <runId>
```

The output is written to:

```text
workspace/{projectId}/runs/{runId}/bridge/bundle.json
workspace/{projectId}/runs/{runId}/bridge/bundle.md
```

## Sample Bundle Notes

The sample bundles under `examples/` are sanitized examples copied from local workspace runs. They preserve the public packet shape and key diagnostic fields while omitting raw payloads and local paths.

The examples intentionally show both:

- a usable packet with successful Source Coverage Repair
- a not-ready packet where Counterevidence Repair failed discovery

## What To Look For

- `Operator Brief` gives a project-ready handoff.
- `Evidence Diagnostics` explains evidence strength and false convergence risk.
- `Repair Attempts` shows what the engine tried to repair.
- `followedEvidence` is usable evidence.
- `failedFollowAttempts` is not usable evidence.
- Discovery failures are visible.
- Raw HTML, raw JSON payloads, raw artifact pointers, full artifact content, and raw adapter error fields are not exported.
