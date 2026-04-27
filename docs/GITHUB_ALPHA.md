# GitHub Alpha

## Product Positioning

Decision Engine is an AI-first headless research engine for evidence-state research packets.

It is a local CLI/MCP research engine that turns a topic into a project-ready packet: diagnostics, source repair, counterevidence checks, and an Operator Brief. It is built for human operators and downstream AI agents that need reusable evidence state, not just a polished answer.

## What It Is

- A local research runtime with CLI and MCP surfaces.
- A packet generator for `bundle.json` and `bundle.md`.
- A quality-control layer for evidence state.
- A handoff format for another AI agent to continue from.

## What It Is Not

- Not a search engine.
- Not a web UI.
- Not a generic summarizer.
- Not a Deep Research clone.
- Not a broad crawler.

## Architecture Flow

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
  -> Operator Brief for humans or downstream AI
```

## Core Demo Walkthrough

Demo topic:

> How should research agents prevent false convergence and source over-reliance?

Primary sample:

- `examples/operator-brief-source-coverage/bundle.md`
- `examples/operator-brief-source-coverage/bundle.json`

This shows a successful Source Coverage Repair path:

- `sourceCoverage.outcome: followed_evidence`
- `candidateCount: 17`
- `allowedUrlCount: 5`
- `followedEvidenceCount: 3`
- `hasOfficialOrPrimaryEvidence: true`
- `falseConvergenceRisk: false`
- `operatorBrief.confidenceStatus: usable_with_caution`

Secondary sample:

- `examples/operator-brief-counterevidence-failed/bundle.md`
- `examples/operator-brief-counterevidence-failed/bundle.json`

This shows an honest failed-discovery path:

- `counterevidence.outcome: failed_discovery`
- discovery errors are visible and sanitized
- `falseConvergenceRisk` remains true
- `counterevidenceChecked` remains false
- `operatorBrief.confidenceStatus: not_ready`

## Why Use This Instead Of Just Asking Deep Research?

Deep Research is useful when you want a finished report. This engine is useful when you need inspectable state that another AI or operator can continue from.

Decision Engine exposes:

- What evidence was used.
- Which sources were official, primary, analysis, community, or internal.
- Whether source coverage was weak.
- Whether false convergence risk remains.
- Which repair passes ran.
- Which follow attempts failed.
- Which gaps should block project use.

The output is a reusable packet, not just a narrative answer.

## Safety And Trust Boundaries

- Search and discovery pages are not promoted as usable evidence.
- Failed follows are separated from usable `followedEvidence`.
- Timeout, blocked, and error artifacts do not become strongest evidence.
- Discovery failures are visible in `repairAttempts`.
- Limitations and risks are not treated as contradictions unless contradiction records exist.
- Exported bundles omit raw HTML, raw JSON payloads, raw artifact pointers, full artifact content, and raw adapter error fields.
- Human review is still required for high-stakes decisions.

## Current Limitations

- No browser UI.
- No-key live search can return interstitial or no-result-link pages.
- Counterevidence Repair v0 is bounded; it is not a generic debate mode.
- Live successful counterevidence acquisition depends on external discovery reliability.
- Current examples are sanitized exports from local workspace runs.
- Project memory and Watch are supporting layers, not the core alpha demo.

## Current Status

| Axis | Status | Notes |
| --- | --- | --- |
| Source Coverage Repair | PASS / CLOSED | Finds direct official/primary evidence when discovery succeeds. |
| Counterevidence Repair v0 | PASS / CLOSED | Bounded pass with honest failed-discovery visibility. |
| Operator Brief v0 | PASS / CLOSED | Export-only handoff layer in JSON and Markdown. |
| GitHub Alpha Packaging | Ready | Docs and sanitized examples only. |
