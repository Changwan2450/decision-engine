# Decision Engine

## Purpose

- 이 저장소는 decision-first research system이다.
- 현재 운영 표면은 `CLI + MCP`다. 웹앱처럼 다루지 않는다.

## Source Of Truth

- 기본 설명과 작업 흐름은 `README.md`가 source of truth다.
- 세부 명세는 `docs/CLI_SPEC.md`를 따른다.

## Default Behavior

- 먼저 `README.md`를 읽고 현재 저장소가 어떤 루프로 동작하는지 파악한다.
- 직접 파일을 뒤지기보다 `CLI`와 `MCP` 표면을 우선 사용한다.
- 분석성 질문은 가능하면 MCP 도구로 처리한다.

## Research Routing

- 리서치 시작 전에는 `QMD`로 `LLM-KB-Core/wiki/`와 현재 프로젝트의 prior decision을 먼저 읽는다.
- KB 검색 기본 명령은 `qmd query "..." --json -n 15 --min-score 0.35 -c wiki`다.
- KB 검색 후 필요한 문서는 `qmd get` 또는 `qmd multi-get`으로만 가져온다.
- `wiki/` 전체를 직접 읽거나 grep해서 KB 검색을 대체하지 않는다.
- KB는 query 확장, 중복 조사 방지, prior pattern 회수에 사용한다.
- `Agent Reach`는 KB를 반복 요약하지 말고 최신 external evidence 수집에 집중한다.
- 최종 판단은 `KB prior + fresh external evidence`를 함께 보되, confidence는 최신 `official/primary_data` 근거를 우선한다.
- 장기 재사용 가치가 확인된 내용만 다시 KB로 승격한다.

## MCP Priority

- core: `get_project`, `get_run`, `show_run_state`, `export_bundle`, `ingest_advisory`
- watch: `run_scheduler_tick`, `trigger_watch`, `list_inbox`, `promote_digest_to_project`, `list_watch_targets`, `list_digests`
- analytics: `query_events`, `query_runs`
- extension: `analyze_hotspots`

## Boundaries

- 내부 decision은 overwrite 하지 않는다.
- advisory는 append-only로 다룬다.
- 보조 명령보다 현재 핵심 표면을 우선한다.
