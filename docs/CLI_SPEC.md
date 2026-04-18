# CLI Spec

## Goal

Decision Engine CLI is the primary AI-facing interface for the research engine.

The contract is:
- predictable command names
- JSON-first stdout
- append-only advisory ingest
- local JSON remains source of truth
- AI operators are the primary caller; human-facing UI is out of scope

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

These tools expose the research engine first. Watch tools are secondary automation
tools layered on top of it.

### Core

- `get_project`
- `get_run`
- `show_run_state`
- `run_research`
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

## Routed Fetch Policy

`run-research` and MCP fetch surfaces use URL routing rather than a single fetcher.
The current policy is intentionally engine-native, not plugin-native.

- Known public mirrors such as `r.jina.ai` / `s.jina.ai` are treated as lightweight public endpoints first.
- Known public feeds such as `/feed`, `/rss`, and `*.xml` are treated as public-feed routes first.
- Platform-specific routes still win when explicitly matched, such as `youtube`, `reddit`, `x`, `github`, and `arxiv`.
- Generic web keeps `scrapling` as primary and `markitdown` as fallback.
- This policy is where `insane-search`-style strategy is absorbed: public endpoint, alternate URL/feed, and mirror-aware routing.
- The engine does not package the external plugin itself.

## MCP Execution Surface

MCP can now start a research run directly instead of only reading an existing run.

The `mcpSummary` shape below is the stable AI-first follow-up contract for the
current orchestration layer. New fields may be added later, but existing fields
should be treated as the baseline operator surface for Claude/Codex flows.

- `run_research`
  - required: `projectId`, `title`
  - optional: `query`, `naturalLanguage`, `pastedContent`, `urls`
  - behavior: creates a new run record, executes the standard research pipeline, applies rule-based query expansion by default on `official` + `recent` axes, returns the resulting run record, and appends `mcpSummary` for AI-first follow-up
  - `mcpSummary`: `runId`, `status`, `decision`, `clarificationQuestions`, `topArtifacts`, `expandedQueries`, `expansionDropped`, `paths`, `recommendedNextTools`, `nextToolCall`, `clarificationTemplate`
  - when status is `awaiting_clarification`, `recommendedNextTools` should lead with `clarify_run`
  - when status is `awaiting_clarification`, `clarificationTemplate.queryTemplate` gives a ready-to-fill `query` shape for `clarify_run`, prefilled with current title, current input, and current pasted content
  - `clarificationTemplate.fieldHints` maps each clarification question to a suggested field such as `goal`, `target`, or `comparisonAxis`
  - follow-up tools: `get_run`, `show_run_state`, `export_bundle`, `gather_for_run`

- `clarify_run`
  - required: `projectId`, `runId`
  - optional: `query`, `naturalLanguage`, `pastedContent`, `urls`
  - behavior: merges clarification input into an existing run, re-executes research on the same `runId`, and returns the same AI-first `mcpSummary` shape
  - intended use: when `run_research` returns `awaiting_clarification`, AI should answer the questions and retry with `clarify_run` instead of creating a fresh run

## MCP Follow-up Matrix

This matrix fixes the current status-to-next-action policy for the AI-first MCP
surface.

| `mcpSummary.status` | Meaning | First next tool | Current rule |
| --- | --- | --- | --- |
| `awaiting_clarification` | input is insufficient to continue safely | `clarify_run` | answer clarification questions on the same `runId` |
| `collecting` | evidence collection is still in-flight or partial | `get_run` | inspect the current run record first |
| `synthesizing` | artifacts exist and synthesis is underway | `get_run` | inspect the current run record first |
| `decided` | decision-oriented run is complete | `show_run_state` | inspect compact run-state snapshot first |
| `failed` | execution failed | `get_run` | inspect failure state and inputs first |
