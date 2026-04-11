# Decision Engine (v1 RC) — a decision-first research system with CLI advisory loop

## What it is

A decision-first research system that:
- turns inputs into evidence
- generates structured decisions
- accumulates insights across runs
- exports to Obsidian
- connects to external CLI (`Codex` / `Claude`) for advisory workflows
- exposes an MCP tool surface for AI-first operation

## Who it is for

- builders using `Claude` / `Codex` CLI
- researchers
- solo devs
- AI power users

## Core Concepts

- Project -> container of work
- Run -> single research execution
- Evidence -> structured claims + sources
- Decision -> `go / no_go / unclear`
- Insights -> accumulated patterns across runs
- Promotion -> reusable knowledge candidates
- Decision History -> timeline of decisions
- External Advisory -> CLI-generated suggestions (read-only)

## Features

- Decision-first research pipeline
- Evidence + contradiction handling
- Decision Layer (`go / no_go / unclear`)
- Project-level insights aggregation
- Obsidian export (`runs + insights + decision history`)
- DuckDB analytics over `events.jsonl`, run JSON, and workspace state
- CLI Bridge (`Codex / Claude`)
  - `prompt_only`
  - `cli_execute`
- MCP tools for run/project access and analytics

## Current Shape

- Headless-first: `CLI + MCP`, not a browser app
- Local JSON is the only source of truth
- DuckDB is a read-only analytics layer
- Obsidian and external CLI are output / advisory layers

## Architecture

- Local-first JSON storage is the source of truth
- Orchestrator pipeline:
  - `plan -> gather -> synthesize -> evidence -> decision -> insights`
- Bridge layer:
  - `bundle -> invoke -> ingest`
- Analytics layer:
  - `events.jsonl -> DuckDB`
  - `run/project JSON -> DuckDB`
- MCP layer:
  - `project/run/bundle/advisory/analytics`
- External CLI is advisory only

## Safety Model

- Internal decision = source of truth
- External CLI cannot overwrite decision
- Advisory = append-only
- Contradictions are explicitly tracked

## Requirements

- Node.js `20.x` required
- `pnpm`
- Optional:
  - `codex` CLI
  - `claude` CLI
  - Obsidian for export

## Quick Start

```bash
pnpm install
pnpm cli --help
```

## Core Entry Points

```bash
pnpm cli --help
pnpm mcp
pnpm test
```

## AI Read Path

When an AI agent enters this repo, the shortest reliable read path is:

1. `README.md`
2. `docs/CLI_SPEC.md`
3. `docs/SCHEMA.md`
4. `workspace/{projectId}/project.json`
5. `workspace/{projectId}/runs/{runId}.json`
6. `workspace/{projectId}/runs/{runId}/bridge/run-state.json`
7. `workspace/{projectId}/runs/{runId}/bridge/events.jsonl`

## CLI Integration

- provider: `codex | claude`
- mode:
  - `prompt_only` -> copy prompt
  - `cli_execute` -> run CLI directly

Advisory output:
- `external_summary`
- `suggested_next_actions`
- `notes`

## MCP Tools

Core:
- `get_project`
- `get_run`
- `show_run_state`
- `export_bundle`
- `ingest_advisory`

Analytics:
- `query_events`
- `query_runs`

Extension:
- `analyze_hotspots`

## Obsidian Export

Path example:

```text
/Users/.../second-brain/DecisionEngine/
```

Exports:
- runs
- insights
- decision-history

## Known Limitations

- No background jobs
- CLI must be installed locally
- macOS subprocess permissions may require manual setup
- Current release is headless-first (`CLI + MCP`), not a web app
- No decision overwrite
- No merge UI
- Some repo history still reflects the removed UI phase
