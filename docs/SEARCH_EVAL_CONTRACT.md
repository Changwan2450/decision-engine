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

## Next Step

The next slice should turn this contract into a stricter search eval harness:

- expand beyond the fixed 4-case pack
- add held-out hard queries
- separate recall failures from synthesis failures
- add budget and stopping-rule checks to live search evaluation
