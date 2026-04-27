# Research Engine

LLMs are good at writing research answers.
They are much worse at keeping track of why those answers should be trusted.

Decision Engine is an AI-first headless research engine for evidence-state research packets. It turns a topic into a local CLI/MCP run with sources, claims, citations, contradictions, diagnostics, repair attempts, failed retrievals, and an Operator Brief.

It is not a search engine.
It is not a web UI.
It is not a Deep Research clone.

It is a research packet generator for AI workflows.

## The Problem

Research answers are easy to generate. Research state is harder.

Serious workflows need to know what happened behind the answer:

- Which sources were found?
- Which claims were extracted?
- Which citations support them?
- Was the evidence mostly supportive?
- Did the run miss official or primary sources?
- Did counterevidence discovery fail?
- Which fetches timed out or got blocked?
- What should the next AI or operator do before using the result?

This repo is built around that state.

## What You Get

An exported run produces two handoff files:

```text
bundle.json  # structured packet for automation
bundle.md    # readable packet for operators and AI agents
```

The packet includes:

- `operatorBrief`: the top-level handoff with status, strongest evidence, unresolved gaps, next actions, and overclaim warnings.
- `evidenceDiagnostics`: decisiveness score, false convergence risk, source coverage status, counterevidence status, and weak-evidence signals.
- `repairAttempts`: what the engine tried to repair, what succeeded, and what failed.
- `evidenceReplay`: compact artifacts, claims, citations, contradictions, retrieval failures, and unresolved evidence gaps.

Failed follows are not treated as evidence. Search and discovery pages are not treated as strongest evidence. Raw payloads stay out of the exported bundle.

## Quick Demo

Demo question:

> How should research agents prevent false convergence and source over-reliance?

The successful sample shows Source Coverage Repair finding direct official/primary evidence and exporting a cautious but usable Operator Brief.

```text
Status: usable_with_caution
Decision summary: go (high)
Source coverage: followed_evidence (3 followed)
Counterevidence: not_attempted (0 followed)
Official/primary evidence: true
False convergence risk: false

Next actions:
- Retry counterevidence check or use a different discovery source.
- Use this brief as project input, but preserve listed gaps and citations.
```

See the samples:

- `examples/operator-brief-source-coverage/bundle.md`
- `examples/operator-brief-source-coverage/bundle.json`
- `examples/operator-brief-counterevidence-failed/bundle.md`
- `examples/operator-brief-counterevidence-failed/bundle.json`

The second sample is intentionally not-ready. It shows a counterevidence discovery failure, keeps `falseConvergenceRisk` true, and tells the operator not to treat the conclusion as settled.

## How It Works

```text
Topic / URLs
  -> CLI or MCP run_research
  -> bounded retrieval adapters
  -> artifacts + claims + citations + contradictions
  -> evidence diagnostics
  -> Source Coverage Repair
  -> Counterevidence Repair v0
  -> export_bundle
  -> bundle.json + bundle.md
  -> Operator Brief
```

The engine is local-first. The current product surface is `CLI + MCP`; workspace files are the source of truth.

## Why Not Just Use Deep Research?

Use Deep Research when you want a polished report.

Use this when you need the evidence state behind the answer:

- the usable sources
- the failed retrievals
- the repair attempts
- the weak-evidence warnings
- the unresolved gaps
- the handoff instructions for another AI

The point is not to out-write a research model. The point is to make the result inspectable and reusable.

## Current Capabilities

- CLI + MCP research runs.
- Bounded retrieval adapters with fallback and budget control.
- Evidence-state output: artifacts, claims, citations, contradictions, diagnostics.
- Source Coverage Repair for missing official/primary evidence.
- Counterevidence Repair v0 for bounded limitation, risk, failure-case, and disagreement checks.
- `followedEvidence` / `failedFollowAttempts` split.
- Operator Brief export for project handoff.
- Sanitized bundle export: no raw HTML, raw JSON payloads, raw artifact pointers, full artifact content, or raw adapter error fields.

## Current Limitations

- No browser UI.
- No-key live discovery can return interstitial or no-result pages; those failures are exposed in the bundle.
- Counterevidence Repair v0 is bounded and inspectable, not a full contradiction engine.
- Not a broad crawler.
- Not recursive autonomous repair.
- Human review is still needed for high-stakes decisions.
- Current alpha examples are sanitized exports copied from local workspace runs.

## Quick Start

```bash
pnpm install
pnpm test
pnpm cli --help
pnpm mcp
```

Export an existing run bundle:

```bash
pnpm cli export-run-bundle --project <projectId> --run <runId>
```

The output directory contains:

```text
workspace/{projectId}/runs/{runId}/bridge/bundle.json
workspace/{projectId}/runs/{runId}/bridge/bundle.md
```

## Demo And Docs

- `docs/GITHUB_ALPHA.md` — GitHub alpha overview, architecture, positioning, and limitations.
- `docs/DEMO.md` — demo walkthrough and sample bundle guide.
- `examples/operator-brief-source-coverage/` — successful Source Coverage Repair sample.
- `examples/operator-brief-counterevidence-failed/` — honest failed-discovery sample.
- `docs/CLI_SPEC.md` — CLI and MCP surface.
- `docs/SCHEMA.md` — persisted file contract.
- `docs/WATCH_LAYER.md` — watch automation boundary.

## Development Status

The alpha path is focused on research packet quality, not UI polish:

- Source Coverage Repair: pass / closed.
- Counterevidence Repair v0: pass / closed.
- Operator Brief v0 export layer: pass / closed.
- GitHub alpha docs and examples: present.

## Legacy Notes

Korean legacy project notes are archived in `docs/LEGACY_NOTES_KO.md`.
