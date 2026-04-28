# State Classification Contract

This engine does not treat all accumulated state as durable knowledge.

Every stored unit must belong to exactly one class:

- `ephemeral`
- `evidence_record`
- `decision_state`
- `adaptive_memory`
- `promoted_knowledge`

If a state cannot be classified, the default action is: `discard`.

## Classes

### `ephemeral`

- purpose: transient work state
- examples:
  - draft run
  - awaiting clarification run
  - failed retry state
- rule:
  - short TTL
  - prune automatically
  - never promoted directly

### `evidence_record`

- purpose: replayable and auditable evidence substrate
- examples:
  - raw payload
  - normalized artifact
  - citation provenance
- rule:
  - compact aggressively
  - keep by reference
  - do not treat as operator-facing memory

### `decision_state`

- purpose: operator-usable result of one run
- examples:
  - claims
  - contradictions
  - evidence summary
  - final decision
- rule:
  - keep compact
  - optimize for reuse by AI/operator
  - do not silently expand back into raw log form

### `adaptive_memory`

- purpose: bounded adaptation state that survived eval gates
- examples:
  - decision ledger
  - topic ledger
  - contradiction ledger
- rule:
  - eval-gated only
  - versioned
  - expiring
  - never replaces evidence or decision state

### `promoted_knowledge`

- purpose: validated long-term reusable knowledge
- examples:
  - KB note
  - decision log
  - promoted watch output
- rule:
  - promote only after validation
  - do not dump raw run state into this layer

## Run Status Mapping

- `draft` -> `ephemeral`
- `awaiting_clarification` -> `ephemeral`
- `collecting` -> `ephemeral`
- `synthesizing` -> `ephemeral`
- `failed` -> `ephemeral`
- `decided` -> `decision_state`

## Hard Rules

- raw-backed artifacts belong to `evidence_record`
- inline operator summaries belong to `decision_state`
- project memory belongs to `adaptive_memory`
- only validated reusable outcomes may enter `promoted_knowledge`
- if a state cannot justify its class, it should not be retained

## Adaptive Memory Governance

- retained memory must carry contract version, TTL, status, and source-run provenance
- only `active`, unexpired, current-contract memory with source-run provenance may enter runtime context
- deprecated, superseded, conflict, expired, legacy, or provenance-free memory must not be retrieved as active context
- newer same-context decision memory supersedes older active decision memory
- same-context decision disagreement must be marked as `conflict` or superseded state, not silently merged as active
- retrieval must stay selective and capped; project memory must not be dumped wholesale into prompts
