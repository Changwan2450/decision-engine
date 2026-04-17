# Schema

## Goal

These are the core file contracts for AI-driven workflows.

Decision Engine is file-contract-first:
- inputs are exported as stable files
- external workers write advisory files
- local JSON remains the source of truth

## 1. `bundle.json`

Location:

```text
workspace/{projectId}/runs/{runId}/bridge/bundle.json
```

Purpose:
- machine-readable context for external CLI or future MCP tools

Minimum shape:

```json
{
  "project": {
    "id": "project-1",
    "name": "Decision Engine",
    "description": "..."
  },
  "latestRun": {
    "id": "run-1",
    "decision": "go",
    "confidence": "medium",
    "why": "...",
    "blockingUnknowns": []
  },
  "insights": {
    "repeatedProblems": [],
    "solutionPatterns": [],
    "competitorSignals": [],
    "conflicts": []
  },
  "decisionHistory": [],
  "kb": {
    "promotionCandidates": [],
    "relatedRuns": [],
    "decisionHistorySummary": [],
    "recentContradictions": [],
    "projectInsightSummary": {}
  },
  "bridge": {
    "provider": "codex",
    "mode": "cli_execute",
    "generatedAt": "2026-04-10T00:00:00.000Z",
    "projectId": "project-1",
    "runId": "run-1",
    "schemaVersion": "cli-bridge-v1"
  }
}
```

## 2. `bundle.md`

Location:

```text
workspace/{projectId}/runs/{runId}/bridge/bundle.md
```

Purpose:
- human-readable prompt payload
- fallback input for CLI tools

Contains:
- project summary
- latest run
- project insights
- decision history
- kb context
- strict advisory instructions

## 3. `advisory.json`

Location:

```text
workspace/{projectId}/runs/{runId}/bridge/advisory.json
```

Purpose:
- external advisory output from `codex` or `claude`

Shape:

```json
{
  "external_summary": "string",
  "suggested_next_actions": ["string"],
  "notes": ["string"]
}
```

Rules:
- advisory only
- no decision overwrite
- parser may normalize non-JSON CLI output into this shape

## 4. Run Record

Location:

```text
workspace/{projectId}/runs/{runId}.json
```

Purpose:
- canonical run state
- source of truth

Relevant sections:
- `normalizedInput`
- `kbContext` (`QMD` 검색 결과 기반 prior)
- `artifacts`
- `claims`
- `citations`
- `contradictions`
- `evidenceSummary`
- `decision`
- `prdSeed`
- `advisory`

Advisory section:

```json
{
  "externalSummary": "string",
  "suggestedNextActions": ["string"],
  "notes": ["string"],
  "provider": "codex",
  "mode": "cli_execute",
  "ingestedAt": "2026-04-10T00:00:00.000Z",
  "executedAt": "2026-04-10T00:00:00.000Z",
  "success": true,
  "schemaVersion": "cli-bridge-v1"
}
```

## 5. `run-state.json`

Location:

```text
workspace/{projectId}/runs/{runId}/bridge/run-state.json
```

Purpose:
- fast state probe for AI agents
- lightweight status without loading the full run record

Contains:
- `projectId`
- `runId`
- `status`
- `updatedAt`
- `decision`
- `artifactCount`
- `advisoryStatus`

## 6. `events.jsonl`

Location:

```text
workspace/{projectId}/runs/{runId}/bridge/events.jsonl
```

Purpose:
- append-only execution trace
- resumable context for AI agents

Current event types include:
- `run_state_written`
- `bundle_exported`
- `advisory_written`
- `advisory_ingested`

## 7. Project Record

Location:

```text
workspace/{projectId}/project.json
```

Purpose:
- project metadata
- project insights
- promotion candidates

## Versioning Rule

- current bridge schema version: `cli-bridge-v1`
- changes to exported file formats should bump schema version explicitly
- internal JSON can evolve, but advisory overwrite remains forbidden
