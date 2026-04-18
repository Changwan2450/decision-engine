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

Shipped in PR 6 (MCP surface):

- MCP tools for Watch workflows (`list_watch_targets`, `get_watch_target`, `trigger_watch`, `list_digests`, `get_digest`, `build_watch_digest`, `list_inbox`, `archive_inbox_item`, `promote_digest_to_project`)

Shipped in PR 7 (interval scheduler):

- `watch_target.schedule` as `discriminatedUnion("kind")` with the `interval` variant; `null` means manual-only
- `watch_target.lastTriggeredAt` for idempotent scheduling
- `isWatchTargetDue(target, now)` due detection based on `status`, `schedule`, and `lastTriggeredAt`
- `runSchedulerTick()` tick-on-demand scheduler that fires all due targets and absorbs per-target failures
- `run_scheduler_tick` MCP tool so external cadence sources (OS cron, Claude scheduled calls, manual MCP) can drive the scheduler — the scheduler itself runs no background timer

## Current Flow

Manual trigger path:

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

Scheduled trigger path (interval schedule, tick-on-demand):

```text
runSchedulerTick(now)
  -> isWatchTargetDue(target, now)          (status/schedule/lastTriggeredAt)
  -> triggerWatchTarget()                   (joins the manual path above)
  -> watch_target.lastTriggeredAt = now
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
- `watchTarget.schedule` (nullable `discriminatedUnion("kind")`)
- `watchTarget.lastTriggeredAt`

## Future Work

Not implemented yet:

- cron trigger kind
- webhook trigger kind
- on-event trigger kind
- inbox delivery channels beyond workspace JSON
- Distill runtime
- KB promotion automation
- richer novelty models beyond simple URL comparison

Reserved but not yet active in runtime:

- digest statuses beyond `pending` and `built`
- `inbox_item.kind = novelty_note`
- additional `schedule.kind` variants (`cron`, `webhook`, `on-event`) — slot into the existing `discriminatedUnion("kind")` without changes to records that already use `interval` or `null`

## Design Guardrails

- Watch should continue reusing Research gather / normalize / artifact plumbing
- Watch should remain an additive layer over current run records
- Future work should not overload `run.mode` with Watch semantics
- New runtime surfaces should preserve traceability from watch target to digest to inbox to promoted run
- `watch_target.schedule` is a `discriminatedUnion("kind")`; new kinds (e.g. `cron`, `webhook`, `on-event`) MUST extend this union instead of introducing parallel schedule fields
- The scheduler stays tick-on-demand. No `setInterval`, `setTimeout`, or background workers may be added to run the scheduler on its own

## When To Update This Document

Update this reference only when shipped behavior changes in Watch.

If there is any conflict between this document and code, prefer:

1. `README.md`
2. `docs/SCHEMA.md`
3. code
