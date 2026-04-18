# System Definition

Canonical definition of what this system is and how its layers fit together.
Use this document to resolve cross-layer and terminology questions.

For implementation status, see `README.md`, `docs/SCHEMA.md`, and the
layer-specific references (`docs/WATCH_LAYER.md`,
`docs/INTEGRATION_ARCHITECTURE.md`). This document does not duplicate them.

## Core Principles

### 0. The center is the Research Engine

This system is primarily an AI-first, headless research engine.

Its main job is to help AI operators such as Claude or Codex gather, normalize,
compare, and retain evidence in a reusable structure.

Watch, Distill, and Memory are secondary layers or processes that extend the
research engine. They must not replace it as the system's primary identity.

### 1. Run modes are not system layers

Run modes (e.g. `quick`, `standard`, `deep`) represent execution depth and resource budget.
They MUST NOT be used to encode system layers such as Watch or Distill.

System layers are orthogonal to execution depth and are expressed through composition,
not through enum expansion.

Any future work MUST preserve this separation.

### 2. Watch is a layer, not a mode

Watch is a continuous tracking layer built on top of the Research runtime.

It does not introduce a new execution system.
Instead, it reuses the existing Research pipeline by attaching additive context
(e.g. `watchContext`) to runs.

Watch is responsible for:
- periodically triggering research runs
- aggregating results into digests
- surfacing signals via inbox and alerts

Watch MUST NOT be represented as a new `run.mode`.

### 3. Distill is a process, not a storage layer

Distill is a transformation process that operates on accumulated evidence
(e.g. artifacts, claims, digests) and promotes stable, repeated signals into Memory.

Distill does not own storage.
It does not introduce new persistence boundaries.

Instead, it acts as a filter and compression step between Research/Watch outputs
and Memory inputs.

The exact rules of Distill (e.g. stability thresholds, promotion criteria)
are intentionally left undefined at this stage and will evolve in later phases.

### 4. Memory is downstream and partially implemented

Memory represents long-term, downstream knowledge storage (e.g. wiki, Obsidian).

It already exists as a downstream system connected to the Research pipeline,
primarily through export and pre-read mechanisms.

However, promotion into Memory is currently manual or tool-assisted.
There is no fully automated promotion pipeline yet.

Future work will formalize and automate the promotion path
from Research/Watch outputs into Memory.

## System Structure

The system is composed of one primary engine, two downstream/automation layers,
and one transformation process:

- Research engine
  Executes on-demand runs to gather, normalize, and synthesize evidence.

- Watch layer
  Continuously monitors topics of interest, triggers research runs,
  and aggregates results into digests and inbox signals.

- Memory layer
  Stores long-term, curated knowledge for retrieval and reuse.

- Distill (process)
  Transforms accumulated evidence into stable knowledge suitable for Memory.

These components share a common substrate:
SourceArtifact, Claim, Citation, Contradiction, and EvidenceSummary.

They differ only in:
- when they run
- how often they run
- what output they produce

## Design Guardrails

- Do not introduce new run modes for Watch or Distill.
- Do not fork the data model between layers.
- All layers MUST reuse the same Research substrate.
- Watch and Distill MUST remain additive over existing runs.
- Memory MUST remain downstream and must not become a source of truth for Research.

Violating these constraints will lead to model divergence and system fragmentation.

## One-line Definition

This system is an AI-first research engine with watch and memory layers — not a static knowledge base.
