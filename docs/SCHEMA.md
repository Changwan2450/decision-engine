# Schema

This document describes the file contracts that exist in the current codebase.

It covers shipped Research and Watch records only. Scheduler state, Distill state, and KB promotion state are future work and are intentionally excluded.

## Storage Boundaries

Current workspace layout:

```text
workspace/{projectId}/project.json
workspace/{projectId}/runs/{runId}.json
workspace/{projectId}/runs/{runId}/bridge/bundle.json
workspace/{projectId}/runs/{runId}/bridge/bundle.md
workspace/{projectId}/runs/{runId}/bridge/advisory.json
workspace/{projectId}/runs/{runId}/bridge/run-state.json
workspace/{projectId}/runs/{runId}/bridge/events.jsonl
workspace/{projectId}/watch-targets/{watchTargetId}.json
workspace/{projectId}/digests/{digestId}.json
workspace/{projectId}/inbox/{itemId}.json
workspace/{projectId}/raw/{...}
```

## Research Records

## 1. `bundle.json`

Location:

```text
workspace/{projectId}/runs/{runId}/bridge/bundle.json
```

Purpose:

- machine-readable context for external CLI or MCP consumers

## 2. `bundle.md`

Location:

```text
workspace/{projectId}/runs/{runId}/bridge/bundle.md
```

Purpose:

- human-readable prompt payload
- fallback input for CLI tools

## 3. `advisory.json`

Location:

```text
workspace/{projectId}/runs/{runId}/bridge/advisory.json
```

Purpose:

- external advisory output from `codex` or `claude`

Rules:

- advisory only
- no decision overwrite
- parser may normalize non-JSON CLI output into this shape

## 4. `run-state.json`

Location:

```text
workspace/{projectId}/runs/{runId}/bridge/run-state.json
```

Purpose:

- fast state probe for AI agents
- lightweight status without loading the full run record

## 5. `events.jsonl`

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

## 6. Project Record

Location:

```text
workspace/{projectId}/project.json
```

Purpose:

- project metadata
- project insights
- promotion candidates

## 7. Run Record

Location:

```text
workspace/{projectId}/runs/{runId}.json
```

Purpose:

- canonical run state
- source of truth for a single Research execution

Key sections:

- `run`
- `watchContext`
- `projectOrigin`
- `normalizedInput`
- `kbContext`
- `artifacts`
- `claims`
- `citations`
- `contradictions`
- `evidenceSummary`
- `decision`
- `prdSeed`
- `advisory`

### `watchContext`

`watchContext` is optional and nullable. It links a normal run back to a Watch trigger without changing `run.mode`.

Example JSON:

```json
{
  "watchTargetId": "watch-1",
  "triggerId": "manual-trigger-1",
  "digestId": null
}
```

Notes:

- present when a run was created from `triggerWatchTarget()`
- absent for ordinary project runs
- `digestId` stays nullable so Watch can attach future context without runtime branching today

### `projectOrigin`

`projectOrigin` is optional and nullable. It links a promoted project run back to the Watch digest that created it.

Example JSON:

```json
{
  "source": "watch_digest",
  "watchTargetId": "watch-1",
  "digestId": "digest-1",
  "inboxItemId": "inbox-1",
  "sourceRunIds": ["run-a", "run-b"]
}
```

Notes:

- present when a run was created by `promoteDigestToProject()`
- absent for normal project runs and watch-triggered research runs
- used by trace helpers such as `findRunsByDigestId()` and `findRunsBySourceRunId()`

## Watch Records

## 8. `watch_target`

Location:

```text
workspace/{projectId}/watch-targets/{watchTargetId}.json
```

Purpose:

- persisted definition of a recurring interest
- input to manual Watch trigger

Minimum shape:

```json
{
  "id": "watch-1",
  "projectId": "project-1",
  "title": "Competitor pricing changes",
  "query": {
    "naturalLanguage": "Track pricing page changes",
    "urls": ["https://example.com/pricing"]
  },
  "sourceFilter": {
    "includeAdapters": [],
    "excludeAdapters": [],
    "includeDomains": [],
    "sourceTypes": []
  },
  "delivery": {
    "digest": true,
    "alert": false,
    "inbox": true
  },
  "tags": [],
  "status": "active",
  "createdAt": "2026-04-17T00:00:00.000Z",
  "updatedAt": "2026-04-17T00:00:00.000Z"
}
```

## 9. `digest`

Location:

```text
workspace/{projectId}/digests/{digestId}.json
```

Purpose:

- first meaningful Watch output
- groups `sourceRunIds` for one `watch_target`

Minimum shape:

```json
{
  "id": "digest-1",
  "projectId": "project-1",
  "watchTargetId": "watch-1",
  "windowStart": "2026-04-17T00:00:00.000Z",
  "windowEnd": "2026-04-17T00:00:00.000Z",
  "sourceRunIds": ["run-a", "run-b"],
  "headline": "2 runs, 1 novel urls",
  "summary": "1 novel urls across 2 source runs",
  "status": "built",
  "createdAt": "2026-04-17T00:00:00.000Z",
  "updatedAt": "2026-04-17T00:00:00.000Z"
}
```

Current status progression:

- `pending`
- `built`

Reserved but not operational yet:

- `delivered`
- `acted_on`
- `ignored`

## 10. `inbox_item`

Location:

```text
workspace/{projectId}/inbox/{itemId}.json
```

Purpose:

- first Watch consumption surface
- records digest and internal alert items

Minimum shape:

```json
{
  "id": "inbox-1",
  "projectId": "project-1",
  "kind": "digest",
  "refId": "digest-1",
  "watchTargetId": "watch-1",
  "status": "unread",
  "promotedRunId": null,
  "title": "Competitor pricing changes digest",
  "summary": "1 novel urls across 2 source runs",
  "createdAt": "2026-04-17T00:00:00.000Z",
  "updatedAt": "2026-04-17T00:00:00.000Z"
}
```

Kinds currently used:

- `digest`
- `alert`

Alert creation rule:

- an `alert` inbox item is created only when `delivery.alert = true` and digest novelty is non-zero

Declared but not yet emitted:

- `novelty_note`

Lifecycle values:

- `unread`
- `read`
- `archived`
- `promoted`

Lifecycle helpers:

- `updateInboxItemRecord()`
- `updateInboxItemStatus()`
- `listInboxItemRecords()`
- `findInboxItemsByRefId()`

Promotion trace:

- when a digest is promoted, the digest inbox item moves to `status = promoted`
- `promotedRunId` is set to the created project run id
- the created run receives `projectOrigin`

## Current Watch Orchestration Contracts

These are runtime links already present in shipped code.

- `triggerWatchTarget(projectId, watchTargetId)`
  - creates a normal run
  - sets `runRecord.watchContext`
  - reuses existing Research execution
- `buildWatchDigest(projectId, watchTargetId, { sourceRunIds })`
  - groups source runs for one watch target
  - computes simple novelty using artifact URLs from previous digests
  - writes a built digest
  - creates inbox items according to `delivery`
- `promoteDigestToProject(projectId, digestId)`
  - creates a normal project run
  - marks the digest inbox item as promoted
  - writes `runRecord.projectOrigin`

## Versioning Rule

- current bridge schema version: `cli-bridge-v1`
- exported file format changes should bump schema version explicitly
- internal JSON may evolve additively, but advisory overwrite remains forbidden
