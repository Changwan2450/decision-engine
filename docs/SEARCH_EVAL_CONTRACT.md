# Search Eval Contract

This contract defines how search quality is judged for research-grade evidence acquisition.

It is intentionally narrower than a generic search benchmark.
The goal is not raw result count. The goal is retrieving decisive evidence, counterevidence, and trustworthy source diversity under budget.

## Version

- version: `2026-04-22.v1`

## Product Framing

- search quality matters because weak retrieval poisons downstream evidence/action layers
- this engine does **not** try to win on generic consumer search UX
- the target is `budgeted retrieval policy for research-grade evidence acquisition`

## Measured Metrics

- `support_recall_floor`
  - minimum usable supporting evidence recovered for the core question
- `counterevidence_recall_floor`
  - minimum credible counterevidence recovered when disagreement exists
- `false_contradiction_rate`
  - contradiction over-generation rate
- `trust_weighted_source_diversity`
  - trust-aware diversity across source classes
- `decisive_evidence_position`
  - how early decisive evidence appears in the retrieved set

## Explicitly Unmeasured For Now

- `manual_rescue_rate`
- `appropriate_abstention_rate`

These are product-important, but the current harness does not yet measure them safely enough.

## Proxy Ban

These are not search-quality signals:

- raw result count
- fanout depth alone
- latency without evidence gain
- click-through rate
- operator satisfaction alone

## Guardrails

- retrieval must be budgeted
- coverage is a floor objective, not the product thesis
- contradiction retrieval is conditional, not global
- stopping and abstention are part of search quality

## Current Case Mapping

- `react-rsc-vs-spa`
  - primary bottleneck: `domain_shifted_recall`
- `typescript-monolith-vs-microservices`
  - primary bottleneck: `domain_shifted_recall`
- `rust-vs-go`
  - primary bottleneck: `source_competition_ranking`
- `ai-memory-vs-prompt-stuffing`
  - primary bottleneck: `conditional_contradiction_retrieval`

## Domain-Shifted Recall Pack

The contract now tracks an expanded domain-shifted recall pack instead of relying only on the fixed 4-case harness.

- total cases: `6`
- held-out cases: `4`
- language mix:
  - `korean_english_mixed`: `4`
  - `english_only`: `2`

Current domain-shifted pack:

- `react-rsc-vs-spa`
- `typescript-monolith-vs-microservices`
- `nextjs-app-router-vs-spa`
- `rag-vs-long-context-korean`
- `postgres-rls-vs-app-authorization`
- `otel-vs-vendor-apm`

## Retrieval Policy Profiles

Search quality is constrained by explicit retrieval policy, not open-ended fan-out.

- `comparison_tradeoff_analysis`
  - max source branches: `4`
  - max query expansions per branch: `2`
  - contradiction mode: `conditional`
- `pre_decision_verification`
  - max source branches: `5`
  - max query expansions per branch: `2`
  - contradiction mode: `required`

Core policy rule:

- stop when decisive evidence exists across trust classes, or when budget is exhausted
- abstain when decisive evidence/freshness minimum is still missing at the budget boundary

## Source Competition Pack

The contract now separately tracks a source competition / ranking pack.

- total cases: `4`
- focus: decisive evidence position and trust-aware source competition

Current source competition pack:

- `rust-vs-go`
- `postgres-rls-vs-app-authorization`
- `otel-vs-vendor-apm`
- `react-rsc-vs-spa`

## Coverage Floor

Coverage is treated as a hygiene floor, not the product thesis.

Coverage floor requirements:

- minimum usable evidence per case: `2`
- minimum trust classes per case: `2`
- max placeholder/auth leaks: `0`
- max allowed coverage-only cases in the contract: `3`

Current coverage floor pack:

- `ai-memory-vs-prompt-stuffing`
- `react-rsc-vs-spa`
- `rag-vs-long-context-korean`

## Conditional Contradiction Retrieval

Contradiction retrieval is not a global objective.
It is enabled only for contradiction-sensitive queries and dispute verification.

Requirements:

- minimum counterevidence per case: `1`
- max false contradiction rate: `0.2`
- required trust classes: `2`

Current conditional contradiction pack:

- `ai-memory-vs-prompt-stuffing`
- `vendor-claim-verification-rsc`
- `policy-memo-rag-vs-finetune`

## Next Step

The next slice should turn this contract into a stricter search eval harness:

- add held-out hard queries
- separate recall failures from synthesis failures
- add budget and stopping-rule checks to live search evaluation
