# Research Quality Eval Contract

This document defines the execution contract for adaptive research behavior.

The engine does **not** optimize for user preference satisfaction. It optimizes for research quality under explicit epistemic guardrails.

## Purpose

- define what counts as a good research run
- define what adaptive behavior is allowed
- define what is never allowed to adapt
- define what can be retained only after quality gates pass

## Contract Version

- version: `2026-04-22.v1`
- retained adaptive state must carry the contract version
- incompatible version defaults to `invalidate_or_revalidate`
- silent migration is forbidden

## Run Types

The contract is run-type specific. There is no single universal definition of a good run.

### `exploratory_scan`

- purpose: broad terrain scan and issue discovery
- success:
  - maintains source diversity
  - reveals reusable questions and topics
- fail:
  - collapses to a narrow source mix
  - reduces evidence breadth vs fresh baseline

### `comparison_tradeoff_analysis`

- purpose: compare options and expose tradeoffs
- success:
  - keeps only option-relevant evidence
  - suppresses off-topic noise
- fail:
  - weakens contradiction exposure
  - drifts into unrelated architecture generalities

### `longitudinal_watch`

- purpose: detect change over time
- success:
  - surfaces focus shift and contradiction delta
  - ranks what must be re-investigated
- fail:
  - invents fake change
  - lowers provenance completeness

### `contradiction_resolution`

- purpose: re-check conflicting claims
- success:
  - keeps supporting and contradicting evidence explicit
  - points follow-up at actual conflict resolution
- fail:
  - increases formal contradictions without better evidence
  - hides key counter-evidence

### `pre_decision_verification`

- purpose: final evidence check before decision
- success:
  - meets freshness and provenance bar
  - exposes remaining counter-evidence
- fail:
  - substitutes proxy metrics for evidence sufficiency
  - weakens freshness or contradiction exposure

## Proxy Ban List

These are not research quality signals:

- user satisfaction alone
- click/open rate
- inbox clear rate
- reading completion
- time saved alone
- operator acceptance without audit
- repeated selection without downstream verification

## Epistemic Core

The following are non-adaptive by default:

- evidence sufficiency thresholds
- contradiction surfacing rules
- source legitimacy rules
- minimum freshness requirements
- minimum provenance/citation requirements

## Context Boundary

- primary trigger: planner/classifier
- uncertain case default: stricter fresh context
- cross-context carryover: disabled by default
- operator override: allowed
- every boundary decision must be logged

## Non-Compensatory Ship Blockers

The following cannot be traded off against packaging or convenience gains:

- contradiction exposure regression
- source diversity floor collapse
- freshness minimum violation
- provenance/citation completeness regression
- cross-context contamination

## Retention Eligibility

Retention is gated by this contract.

An adaptive state is eligible only if it is:

- repeatable
- attributable to a quality uplift hypothesis
- scoped to a project/context/run type
- non-core
- expiry-ready

Required hard rules:

- TTL required
- revalidation required
- contract version required
- inspectable and reversible

Budgets:

- max adaptive entries per project: 12
- max adaptive entries per run type: 4

## Baseline Harness Rule

Baselines:

- `fresh_no_memory`
- `project_memory_only`
- `adaptive_policy_on`

Rules:

- adaptive policy must beat `fresh_no_memory` on allowed quality metrics
- any non-compensatory blocker breach fails regardless of other gains
- adaptive policy rollback triggers when guarded metrics lose to `fresh_no_memory`

## Bootstrap Evidence

This contract is not written from theory alone.

Before tightening the contract further:

- collect evaluated run samples
- manually review representative runs
- attach sample judgments as bootstrap evidence for future contract revisions
