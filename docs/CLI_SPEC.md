# CLI Spec

## Goal

Decision Engine CLI is the primary AI-facing interface.

The contract is:
- predictable command names
- JSON-first stdout
- append-only advisory ingest
- local JSON remains source of truth

## Standard Commands

### `create-project`

Create a new project.

```bash
pnpm cli create-project --name "Decision Engine" --description "AI-first research"
```

Output:

```json
{
  "id": "project-1",
  "name": "Decision Engine"
}
```

### `create-run`

Create a run under a project.

```bash
pnpm cli create-run --project project-1 --title "시장 진입 판단" --query "..." 
```

Output:

```json
{
  "id": "run-1",
  "title": "시장 진입 판단",
  "status": "draft"
}
```

### `run-research`

Execute the internal research pipeline.

```bash
pnpm cli run-research --project project-1 --run run-1
```

Output:

```json
{
  "status": "decided",
  "decision": {
    "value": "go"
  }
}
```

### `export-run-bundle`

Export `bundle.json` and `bundle.md` for external CLI usage.

```bash
pnpm cli export-run-bundle --project project-1 --run run-1
```

Output:

```json
{
  "projectId": "project-1",
  "runId": "run-1",
  "bundleDir": ".../workspace/project-1/runs/run-1/bridge"
}
```

### `execute-external`

Run external CLI (`codex` or `claude`) against the exported bundle.

```bash
pnpm cli execute-external --project project-1 --run run-1 --provider codex
```

Output:

```json
{
  "projectId": "project-1",
  "runId": "run-1",
  "provider": "codex",
  "advisoryPath": "workspace/project-1/runs/run-1/bridge/advisory.json"
}
```

### `ingest-advisory`

Append advisory output into the run record.

```bash
pnpm cli ingest-advisory --project project-1 --run run-1 --provider codex
```

Output:

```json
{
  "projectId": "project-1",
  "runId": "run-1",
  "provider": "codex",
  "ingested": true
}
```

### `show-run`

Return run-level machine-readable state.

```bash
pnpm cli show-run --project project-1 --run run-1
```

Output:
- project summary
- run metadata
- decision
- advisory
- run count

### `show-project`

Return project-level machine-readable state.

```bash
pnpm cli show-project --project project-1
```

Output:
- project metadata
- insights
- promotion candidates
- run count

## MCP Tools

### Core

- `get_project`
- `get_run`
- `show_run_state`
- `export_bundle`
- `ingest_advisory`

### Analytics

- `query_events`
- `query_runs`

### Extension

- `analyze_hotspots`

`analyze_hotspots` is not required for the main run/advisory loop. It is an auxiliary analysis tool.

## Compatibility Notes

- `show-run-state` is still accepted as a compatibility alias for `show-run`
- `list-projects`, `list-runs`, `write-evidence`, `synthesize-run`, `export-obsidian` remain available, but they are secondary to the AI-first core command set

## Output Rules

- stdout should be JSON when the command completes successfully
- stderr may contain operational errors
- internal decision must never be overwritten by external advisory
- advisory remains append-only
