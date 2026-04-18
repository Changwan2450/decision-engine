# Decision Engine

Decision Engine은 AI가 더 효율적으로 리서치하도록 돕는 로컬 중심 헤드리스 리서치 엔진이다.
입력과 URL을 근거가 남는 research run으로 바꾸고, 필요할 때만 Watch / Memory 레이어를 통해 추적과 축적을 붙인다. 현재 제품 표면은 웹앱이 아니라 `CLI + MCP`이며, workspace 아래 파일이 source of truth다.

## 이 엔진이 이미 해주는 일

- 각 URL을 단일 fetch 경로에 맡기지 않고 primary / fallback adapter로 라우팅한다.
- total / per-url / per-adapter budget을 적용해 fallback이 무한정 돌지 않게 제어한다.
- 원본 payload와 정규화된 markdown을 함께 보존해, 원문과 작업용 표현을 동시에 남긴다.
- 실행 결과를 source artifact, claims, citations, contradictions, evidence summary, decision-oriented state로 구조화한다.
- 사람이 직접 읽기 좋게 정리하는 것보다, Claude / Codex 같은 AI가 다시 쓰기 좋게 structured state를 남기는 데 초점을 둔다.
- 반복적으로 추적할 관심사를 watch target으로 저장하고, watch-linked run -> digest -> inbox -> project 승격 흐름으로 연결한다.
- 승격된 project run이 어떤 watch target, digest, inbox item, source runs에서 나왔는지 역추적 가능하게 남긴다.

## 왜 단순 위키나 스크래퍼가 아닌가

이 저장소는 사람 중심 개인 위키나 단순 스크래퍼가 아니다.
핵심은 AI가 필요할 때 더 강하게 검색하고, 더 나은 근거 상태를 남기며, 살아남은 결과만 downstream 레이어로 넘기게 만드는 것이다.
수집 -> 정규화 -> 근거 보존 -> decision-oriented run -> optional watch automation -> downstream accumulation까지 이미 닫혀 있다.

- 단순 fetch가 아니다. URL마다 adapter routing, fallback, budget control이 붙어 있다.
- 단순 저장이 아니다. raw payload, normalized markdown, 구조화된 evidence state를 함께 남긴다.
- 단순 요약이 아니다. run record 안에 claims, citations, contradictions, decision-oriented output이 같이 쌓인다.
- 단순 watch rule 저장이 아니다. watch-linked runs를 digest, inbox item, promotion-ready project work로 바꾼다.
- 위키는 중심이 아니다. 살아남은 결과를 쌓는 downstream 축적 레이어일 뿐이다.
- promoted run은 watch target, digest, inbox item, source runs까지 명시적으로 origin link를 가진다.

## 지금 할 수 있는 일

- URL을 대상으로 routed research를 실행할 수 있다.
- raw payload와 normalized markdown을 나란히 저장할 수 있다.
- artifacts, claims, citations, contradictions, decision-oriented state가 들어 있는 run record를 만들 수 있다.
- watch target을 저장하고 수동 trigger로 일반 research run을 만들 수 있다.
- watch-linked source runs를 묶어 digest를 만들 수 있다.
- digest와 optional internal alert에 대한 inbox item을 만들 수 있다.
- digest를 일반 project run으로 승격할 수 있다.
- MCP를 통해 project, run, analytics, fetch surface에 접근할 수 있다.

## 이 프로젝트의 중심과 부가 레이어

- 중심: AI-first headless research engine
- 부가: Watch automation
- 부가: Memory / wiki accumulation
- 부가: 외부 리서치 보조 도구와 MCP/CLI 표면

Watch와 Memory는 메인 제품이 아니다.
둘 다 리서치 엔진 위에 붙는 자동화 / 축적 레이어다.

## 아직 없는 것

아래 항목은 아직 구현되지 않았다. 현재 기능처럼 읽히면 안 된다.

- background scheduler / cron / webhook 기반 watch 실행
- Distill runtime
- KB promotion automation
- browser UI
- 현재 shared surface를 넘어서는 watch-specific MCP 확장
- 지금의 단순 URL 비교를 넘어서는 richer novelty model

## 핵심 흐름

이 저장소를 이해하는 가장 쉬운 방법은 Research와 Watch의 입력 -> 처리 -> 출력 흐름을 보는 것이다.

### Research 흐름

Research는 입력과 URL을 받아, 수집과 정규화를 거쳐 판단 가능한 run record를 만든다.

```text
입력 + URL
  -> URL별 라우팅
  -> primary / fallback adapter 실행
  -> budget control
  -> raw payload 보존
  -> markdown 정규화
  -> artifacts + claims + citations + contradictions 생성
  -> decision-oriented run record 기록
```

Research run 하나를 돌리면 남는 것:

- fallback behavior가 포함된 routed URL handling
- raw payload와 normalized markdown
- fetch metadata와 `rawRef`가 들어 있는 source artifacts
- 하나의 run record 안에 모인 claims, citations, contradictions, evidence summary

### Watch 흐름

Watch는 새로운 수집기가 아니라 기존 Research 실행을 재사용해 반복 관심사를 digest와 project work로 바꾸는 흐름이다.

```text
watch_target
  -> 수동 trigger
  -> watchContext가 붙은 research run
  -> sourceRunIds 기반 digest 생성
  -> inbox item 생성
  -> 일반 project run으로 승격
  -> projectOrigin trace links 기록
```

현재 Watch loop를 돌리면 남는 것:

- 반복 관심사를 담은 `watch_target`
- 일반 research run으로 연결되는 수동 trigger
- watch-linked source runs 위에 만들어진 digest
- digest와 optional alert에 대한 inbox item
- watch target, digest, inbox item, source runs까지 역추적 가능한 promoted project run

## 저장 구조

현재 상태는 모두 workspace 아래 JSON 파일로 저장된다.

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

## MCP 도구

현재 MCP에서는 조회, 분석, 수집 보조 표면이 열려 있다.

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

AI-first execution surface:

- `run_research`
- `clarify_run`

`run_research`와 `clarify_run`은 현재 orchestration layer의 핵심 표면이다.
이 둘은 AI가 run을 만들고, clarification을 같은 run에서 보완하고, 다음
tool call까지 이어 가도록 돕는다.

## AI Operator Flow

Claude/Codex가 현재 가장 효율적으로 이 엔진을 쓰는 표준 흐름은 아래다.

```text
run_research
  -> mcpSummary 확인
  -> awaiting_clarification 이면 clarify_run
  -> decided 이면 show_run_state
  -> 필요 시 export_bundle
```

실전 one-shot 예시:

1. `run_research(projectId, title, query, urls)`를 호출한다.
2. `mcpSummary.status`를 본다.
3. `awaiting_clarification`이면 `mcpSummary.clarificationTemplate`를 채워 `clarify_run(projectId, runId, query)`를 호출한다.
4. `decided`이면 `mcpSummary.nextToolCall`에 따라 `show_run_state(projectId, runId)`를 먼저 호출한다.
5. 외부 모델 전달이나 상세 근거 묶음이 필요할 때만 `export_bundle(projectId, runId)`를 호출한다.

## Orchestration Boundary

현재까지 강화한 것은 검색 지능 자체보다 orchestration layer다.

- 이미 닫힌 것:
  - routed fetchers
  - MCP run start/retry surface
  - stable `mcpSummary` follow-up contract
  - clarification retry on the same `runId`
  - AI-first next action hints

- 아직 다음 단계로 남겨 둔 것:
  - query expansion
  - source competition / source ranking
  - contradiction-driven follow-up
  - richer search intelligence

즉, 지금까지의 마무리는 "AI가 덜 헤매게 하는 orchestration"을 고정하는 단계다.
다음 기능 단계부터는 "AI가 더 똑똑하게 찾게 하는 search intelligence"로 넘어간다.

## 빠른 시작

설치 후 테스트를 돌리고 CLI와 MCP 표면을 확인하면 현재 상태를 바로 볼 수 있다.

```bash
pnpm install
pnpm test
pnpm cli --help
pnpm mcp
```

최소 흐름:

1. 의존성을 설치한다.
2. 테스트를 실행해 workspace 상태를 확인한다.
3. `pnpm cli --help`로 CLI 표면을 확인한다.
4. MCP를 띄워 project 또는 run 상태를 확인한다.

## 문서

아래 문서 3개가 현재 구현 상태를 이해하는 가장 짧은 경로다.

- `docs/SCHEMA.md` — 현재 file contract와 Watch / Research record shape
- `docs/WATCH_LAYER.md` — Watch reference note와 implemented / future work 경계
- `docs/CLI_SPEC.md` — CLI와 MCP 표면 상세
