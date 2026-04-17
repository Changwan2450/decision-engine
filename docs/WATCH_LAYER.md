# Watch Layer Reference

This document is a reference note, not the source of truth.

The source of truth for shipped behavior is:

1. `README.md`
2. `docs/SCHEMA.md`
3. the current code in `lib/storage/*` and `lib/orchestrator/watch-*`

This file exists to separate what is already implemented from what may come next.

## Current Position

Watch is implemented as a layer on top of the existing Research substrate.

- Watch does not introduce a new fetch pipeline
- Watch does not introduce a new `run.mode`
- Watch creates and links normal runs through `watchContext`
- Watch promotes into normal project runs through `projectOrigin`

Current `run.mode` remains the Research execution-depth axis:

- `quick`
- `standard`
- `deep`

This document intentionally avoids using `RunMode` for Watch concepts.

## Implemented Now

Shipped in W1 to W5:

- `watch_target` schema
- `digest` schema
- `inbox_item` schema
- nullable `watchContext` on run records
- nullable `projectOrigin` on run records
- manual watch trigger into a normal Research run
- digest build from `sourceRunIds`
- simple novelty detection based on artifact URLs seen in earlier digests for the same watch target
- digest inbox item creation
- internal alert inbox item creation when `delivery.alert` is enabled and novelty is non-zero
- digest promotion into a normal project run
- inbox lifecycle helpers and trace helpers

## Current Flow

```text
watch_target
  -> triggerWatchTarget()
  -> runRecord.watchContext
  -> executeResearchRun()
  -> buildWatchDigest(sourceRunIds)
  -> digest(status: pending -> built)
  -> inbox_item(kind: digest, optional alert)
  -> promoteDigestToProject()
  -> runRecord.projectOrigin
```

## Data Contracts in Use

Primary records:

- `workspace/{projectId}/watch-targets/{watchTargetId}.json`
- `workspace/{projectId}/digests/{digestId}.json`
- `workspace/{projectId}/inbox/{itemId}.json`
- `workspace/{projectId}/runs/{runId}.json`

Important links:

- `runRecord.watchContext.watchTargetId`
- `runRecord.watchContext.digestId`
- `digest.watchTargetId`
- `digest.sourceRunIds`
- `inbox_item.refId = digest.id`
- `inbox_item.promotedRunId`
- `runRecord.projectOrigin.digestId`
- `runRecord.projectOrigin.inboxItemId`
- `runRecord.projectOrigin.sourceRunIds`

## Future Work

Not implemented yet:

- scheduler / cron / webhook trigger sources
- inbox delivery channels beyond workspace JSON
- watch-specific MCP tools
- Distill runtime
- KB promotion automation
- richer novelty models beyond simple URL comparison

Reserved but not yet active in runtime:

- digest statuses beyond `pending` and `built`
- `inbox_item.kind = novelty_note`

## Design Guardrails

- Watch should continue reusing Research gather / normalize / artifact plumbing
- Watch should remain an additive layer over current run records
- Future work should not overload `run.mode` with Watch semantics
- New runtime surfaces should preserve traceability from watch target to digest to inbox to promoted run

## When To Update This Document

Update this reference only when shipped behavior changes in Watch.

If there is any conflict between this document and code, prefer:

1. `README.md`
2. `docs/SCHEMA.md`
3. code
