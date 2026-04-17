# Decision Engine

Decision Engine is a local-first research engine that turns inputs and URLs into traceable research runs, watch digests, inbox items, and promotion-ready project work.
It runs as `CLI + MCP`, with workspace files as the source of truth.

한국어: Decision Engine은 입력과 URL을 근거 있는 리서치 실행 결과, Watch digest, inbox item, 프로젝트 승격 후보로 바꾸는 로컬 중심 리서치 엔진이다.
현재 제품 표면은 웹앱이 아니라 `CLI + MCP`다.

## What This Engine Already Does

한국어: 지금 이 엔진이 실제로 어디까지 해주는지 먼저 보여준다.

- It routes each URL through primary and fallback adapters instead of relying on one fetch path.
- It applies total, per-URL, and per-adapter budget control so fallback does not run blindly.
- It preserves raw payloads and normalized markdown together, so runs keep both the original source and the cleaned working form.
- It writes decision-oriented run state with source artifacts, claims, citations, contradictions, and evidence summaries.
- It turns recurring interests into watch targets, watch-linked runs, digests, inbox items, and promotion-ready project work.
- It keeps promoted project runs traceable back to the watch target, digest, inbox item, and source runs that produced them.

## Why This Is More Than A Simple Wiki Or Scraper

한국어: 이 저장소는 단순히 URL을 긁어 저장하거나 위키 노트를 쌓는 수준이 아니다.
수집 -> 정규화 -> 근거 보존 -> digest -> inbox -> project 승격까지 이미 이어진다.

- It does not just fetch pages. It routes URLs through adapters with fallback and budget control.
- It does not just save notes. It preserves raw payloads, normalized content, and structured evidence state.
- It does not just summarize a run. It keeps claims, citations, contradictions, and decision-oriented output in the run record.
- It does not just store watch rules. It turns watch-linked runs into digests, inbox items, and promotion-ready project work.
- Promoted runs keep explicit origin links back to the watch target, digest, inbox item, and source runs.

## What You Can Do Today

한국어: 현재 구현된 기능만 적는다.

- Run routed research over URLs with primary and fallback adapters.
- Keep raw payloads and normalized markdown side by side.
- Produce run records with artifacts, claims, citations, contradictions, and decision-oriented state.
- Save watch targets and manually trigger them into normal research runs.
- Build digests from watch-linked source runs.
- Create inbox items for digests and optional internal alerts.
- Promote a digest into a normal project run with explicit origin links.
- Access project, run, analytics, and fetch surfaces through MCP tools.

## What Is Not Built Yet

한국어: 아래 항목은 아직 없다. 현재 기능처럼 읽히면 안 되는 것들이다.

- Background scheduler, cron, or webhook-driven watch execution
- Distill runtime
- KB promotion automation
- Browser UI
- Watch-specific MCP expansion beyond the current shared surface
- Rich novelty models beyond the current simple URL-based comparison

## Core Flows

한국어: 이 저장소를 이해하는 가장 쉬운 방법은 Research와 Watch의 입력 -> 처리 -> 출력 흐름을 보는 것이다.

### Research Flow

한국어: Research는 입력과 URL을 받아, 수집/정규화/근거 정리를 거쳐 판단 가능한 run record를 만든다.

```text
input + urls
  -> route each url
  -> primary/fallback adapter execution
  -> budget control
  -> raw payload preservation
  -> markdown normalization
  -> artifacts + claims + citations + contradictions
  -> decision-oriented run record
```

What you get from one research run:

- Routed URL handling with fallback behavior
- Raw payloads plus normalized markdown
- Source artifacts with fetch metadata and `rawRef`
- Claims, citations, contradictions, and evidence summary in one run record

### Watch Flow

한국어: Watch는 새로운 수집기가 아니라 기존 Research 실행을 재사용해 반복 관심사를 digest와 project work로 바꾸는 흐름이다.

```text
watch_target
  -> manual trigger
  -> research run with watchContext
  -> digest from sourceRunIds
  -> inbox item
  -> promote to normal project run
  -> projectOrigin trace links
```

What you get from the Watch loop today:

- Saved recurring interests as `watch_target`
- Manual trigger into a normal research run
- Built digest over watch-linked source runs
- Inbox item for digest and optional alert
- Promoted project run that can be traced back to the watch target, digest, inbox item, and source runs

## Storage Layout

한국어: 현재 상태는 모두 workspace 아래 JSON 파일로 저장된다.

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

한국어: 현재 MCP에서는 조회, 분석, 수집 보조 표면이 열려 있다.

Core:

- `get_project`
- `get_run`
- `show_run_state`
- `export_bundle`
- `ingest_advisory`

Analytics:

- `query_events`
- `query_runs`

Fetch surface:

- `fetch_web`
- `gather_for_run`

Extension:

- `analyze_hotspots`

## Quick Start

한국어: 설치 후 테스트를 돌리고 MCP 서버를 띄우면 현재 표면을 바로 확인할 수 있다.

```bash
pnpm install
pnpm test
pnpm cli --help
pnpm mcp
```

Minimal flow:

1. Install dependencies.
2. Run tests to verify the workspace.
3. Inspect the CLI surface with `pnpm cli --help`.
4. Start MCP and inspect project or run state through the available tools.

## Docs

한국어: 아래 문서 3개가 현재 구현 상태를 이해하는 가장 짧은 경로다.

- `docs/SCHEMA.md` — current file contracts and Watch/Research record shapes
- `docs/WATCH_LAYER.md` — Watch reference note, implemented vs future work
- `docs/CLI_SPEC.md` — CLI and MCP surface details
