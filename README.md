# Decision Engine

Decision Engine is a decision-first research OS.

It is not a browser app and not a generic note-taking wiki. The current product surface is `CLI + MCP`, with local JSON as the source of truth and DuckDB as a read-only analytics layer.

## What Exists Now

Two layers are implemented today.

- Research layer:
  - creates a run from normalized input
  - gathers source artifacts through routed adapters
  - normalizes content to markdown
  - stores raw payloads with `rawRef`
  - produces claims, citations, contradictions, evidence summary, and decision state
- Watch layer:
  - stores `watch_target`, `digest`, and `inbox_item`
  - manually triggers a watch target into a normal research run
  - groups watch-linked runs into a digest with simple novelty detection
  - creates inbox items from built digests
  - promotes a digest into a normal project run with explicit trace links

## Implemented vs Future Work

Implemented:

- Research PR 1 to PR 4
- Watch PR W1 to W5
- Watch shipped surface: manual trigger -> digest -> inbox -> promote with traceable links
- MCP surface for project/run access, analytics, and routed web fetching

Not implemented yet:

- scheduler / cron / webhook driven watch execution
- Distill runtime
- KB promotion automation
- browser UI
- watch-specific MCP expansion beyond the current Research surface

## Core Model

- Project: container of work and accumulated insights
- Run: one research execution
- Source artifact: fetched and normalized source plus metadata
- Decision: `go | no_go | unclear`
- Watch target: saved recurring interest definition
- Digest: grouped output over watch-linked source runs
- Inbox item: first Watch consumption surface
- Project origin: trace from promoted Watch output back into a normal project run

## Runtime Shape

- Headless-first: `CLI + MCP`
- Local workspace JSON is the source of truth
- QMD is the required KB search layer in front of Obsidian wiki prior
- External CLI remains advisory only
- `run.mode` is still Research execution depth: `quick | standard | deep`
- Watch uses `watchContext` and `projectOrigin`; it does not add a new run mode

## Research Flow

Research runs use one routed gather path.

1. Normalize input.
2. Read KB prior through QMD.
3. Route each URL with `routeUrl()`.
4. Try primary adapter, then fallback adapters within budget.
5. Normalize fetched content to markdown and store raw payloads.
6. Build source artifacts, claims, citations, contradictions, and decision state.

Current Research implementation includes:

- adapter contract unification
- `scrapling` and `agent-reach` adapters
- router rules and adapter registry
- total / per-url / per-adapter budgets with fallback budget guard
- MCP `fetch_web(url)` and `gather_for_run(runId)`

## Watch Flow

Watch reuses the Research substrate. It is a different run creation path, not a different fetch pipeline.

1. Save a `watch_target`.
2. Manually trigger it.
3. Create a normal run with `watchContext`.
4. Reuse the existing Research runtime.
5. Build a digest from `sourceRunIds`.
6. Create inbox items from the built digest.
7. Promote a digest into a normal project run with `projectOrigin`.

Minimal example flow:

```text
watch_target
  -> triggerWatchTarget()
  -> runRecord.watchContext
  -> executeResearchRun()
  -> buildWatchDigest(sourceRunIds)
  -> inbox_item(kind=digest)
  -> promoteDigestToProject()
  -> runRecord.projectOrigin
```

## Storage Layout

Workspace paths in current use:

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

Research fetch surface:

- `fetch_web`
- `gather_for_run`

Extension:

- `analyze_hotspots`

## CLI Entry Points

```bash
pnpm install
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

## KB Search Rules

- KB 검색은 항상 `QMD`를 먼저 쓴다.
- 기본 검색:
  - `qmd query "질문 또는 키워드" --json -n 15 --min-score 0.35 -c wiki`
- 정밀 검색:
  - `qmd query "..." --all --files --json -c wiki`
- 필요한 문서 본문은 `qmd get` 또는 `qmd multi-get`으로 가져온다.
- `wiki/` 전체를 직접 읽거나 grep해서 KB 검색을 대체하지 않는다.

## Safety Model

- Internal decision remains the source of truth
- External CLI cannot overwrite a decision
- Advisory is append-only
- Watch promotion creates trace links but does not overwrite prior run history

## Current Limits

- No background scheduler
- No Distill runtime
- No KB promotion automation
- No browser UI
- CLI tools must be installed locally when used
