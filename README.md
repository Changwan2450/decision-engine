# Decision Engine

Decision-first research workspace

Messy input을 structured research, evidence, decision (`go / no_go / unclear`), PRD seed로 바꾸는 로컬 퍼스트 AI 서비스다.

## What it does

- natural language / pasted text / URLs 입력을 받는다
- `plan -> gather -> evidence -> decision -> PRD seed` 흐름으로 정리한다
- 프로젝트 단위 insight board를 누적한다
- KB promotion candidate 상태를 추천한다

## Core Philosophy

> Not a research tool. A decision engine.

## Current MVP Scope

- 프로젝트 생성
- 런 생성/실행
- clarify gate
- adapter-based artifact collection
- evidence / contradiction handling
- decision layer
- PRD seed
- project insight board
- KB promotion suggestion state

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Zod
- Local JSON workspace
- Vitest
- Playwright

## Getting Started

```bash
nvm use 20
pnpm install
pnpm dev
```

## Test

```bash
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm test:e2e` 는 macOS Chromium 권한 이슈로 자동 실행이 실패할 수 있다.

## Project Structure

- `app/`
- `components/`
- `lib/`
- `tests/`
- `e2e/`
- `workspace/`

## Status

MVP v1 complete

## Notes

- Node 20.x required
- local-first JSON workspace
- adapter integrations are MVP/stub level where applicable
