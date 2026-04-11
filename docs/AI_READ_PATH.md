# AI Read Path

## Goal

Give Claude/Codex the shortest stable path to understand current state without guessing.

## Order

1. `README.md`
2. `docs/CLI_SPEC.md`
3. `docs/SCHEMA.md`
4. `workspace/{projectId}/project.json`
5. `workspace/{projectId}/runs/{runId}.json`
6. `workspace/{projectId}/runs/{runId}/bridge/run-state.json`
7. `workspace/{projectId}/runs/{runId}/bridge/events.jsonl`

## How to read

- `project.json`
  - project metadata
  - accumulated insights
  - promotion candidates

- `runs/{runId}.json`
  - canonical run record
  - evidence, decision, prdSeed, advisory

- `bridge/run-state.json`
  - fastest status probe
  - use before loading the full run if only state is needed

- `bridge/events.jsonl`
  - append-only trace
  - use when resuming after interruption or failure

- `bridge/bundle.json`
  - outbound context for external CLI or MCP-driven workflows
  - not source of truth

- `bridge/advisory.json`
  - external advisory payload
  - not source of truth

## Rule

- Internal JSON is the source of truth.
- Bridge files are operational layers.
- DuckDB is query-only and must not become a write path.
