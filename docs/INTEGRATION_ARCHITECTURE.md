# Integration Architecture — Decision Engine × External Reach Stack

<!--
AI-AGENT-CONTEXT
purpose: clone workspace 레포들을 Decision Engine에 어떻게 물릴지에 대한 통합 설계
scope: community / video / pdf / general-web(+blocked) 4개 source track 전부 커버
status: partial implementation
last-updated: 2026-04-18
-->

## 1. 목표

AI(Claude / Codex)가 Decision Engine에 명령 한 줄만 던지면 실제로 세상의 데이터를 긁어와서
evidence → decision → insight까지 한 루프로 돌게 만드는 것.

구체적으로는 다음 4가지 소스 트랙을 전부 수집할 수 있게 한다.

| 소스 트랙 | 대상 플랫폼 예시 | 주요 난이도 |
|---|---|---|
| **community** | Reddit, Twitter/X, 디시, 아카라이브, 한국 커뮤니티 | 로그인 벽 / 봇 차단 |
| **video** | YouTube, Bilibili, 팟캐스트, TikTok | 자막·스크립트 추출 |
| **pdf/document** | 논문, 공식 PDF, 기업 공시 문서 | 구조화·OCR |
| **general-web (blocked)** | Cloudflare Turnstile, 국가 차단, reCAPTCHA | 우회 fetcher |

---

## 2. 현재 상태 진단

### 2.1 잘 짜여 있는 부분 (이대로 써도 됨)

- `lib/adapters/types.ts` — `SourceTarget`, `SourceArtifact`, `ResearchAdapter` 인터페이스 정의됨.
  어댑터만 추가하면 오케스트레이터가 자동으로 병렬 실행.
- `lib/orchestrator/run-research.ts` — `adapters.filter(supports).execute()` 패턴.
  새 어댑터 register 한 줄만 추가하면 파이프라인 전체가 굴러감.
- `lib/bridge/` — `cli-bundle`, `cli-invoke`, `cli-ingest` 3단 구조.
  외부 CLI 프로세스 실행 추상화가 이미 있음.
- `lib/mcp/server.ts` — MCP 표면이 이미 존재 (읽기 도구 중심).

### 2.2 현재 구현 상태 (2026-04-18 기준)

| 항목 | 현재 | 문제 |
|---|---|---|
| `agent-reach.ts` | local Agent-Reach repo의 `WebChannel.read()`를 Python bridge로 호출 | platform-specific search/read 확장은 아직 후속 범위 |
| `reclip.ts` | `yt-dlp -J` 기반 metadata/subtitle/description fallback 구현 | local STT까지는 아직 안 붙음 |
| Scrapling 어댑터 | Scrapling CLI `get -> fetch -> stealthy-fetch` escalation 구현 | cookies/proxy per-host 정책은 아직 얕음 |
| PDF 어댑터 | `opendataloader-pdf` 연결 완료 | richer PDF heuristics는 후속 범위 |
| 정규화 레이어 | `markitdown` normalize + raw payload 저장 사용 중 | 어댑터별 richer normalization은 여지 있음 |
| MCP 수집 도구 | 없음 (읽기만 있음) | AI가 MCP로 직접 "가서 긁어와" 불가능 |
| Multi-provider CLI | codex/claude 2개만 하드코딩 | Gemini 등 추가 고비용 |

### 2.3 타입 확장 필요

`SourceTarget`에 `"pdf"` (또는 `"document"`) 누락. 논문 트랙을 위해 추가 필요.

```ts
// lib/adapters/types.ts — 수정 후
export type SourceTarget =
  | "web"
  | "community"
  | "video"
  | "github"
  | "geocoding"
  | "kb"
  | "pdf";         // ← 추가
```

`SourceArtifact`에 bypass / fetcher 메타 필드를 metadata로만 유지하되, 표준 키를 정의.

```ts
// metadata convention (예약 키)
{
  // 식별
  "fetcher":            "scrapling | agent-reach | reclip | opendataloader-pdf | markitdown",
  "source_label":       "community/reddit | video/youtube | pdf/arxiv | web/generic",
  "rate_limit_bucket":  "reddit | twitter | youtube | generic",

  // 수집 결과 (실패 진단용 표준화)
  "fetch_status":       "success | partial | blocked | timeout | error",
  "block_reason":       "turnstile | login | geo | captcha | ratelimit | unknown",
  "bypass_level":       "none | headers | tls | turnstile | headless",

  // 조건 플래그
  "ocr":                "yes | no",
  "login_required":     "true | false"
}
```

`fetch_status`와 `block_reason`은 **모든 어댑터가 의무적으로 채워야 하는 필드**.
나중에 "왜 이 소스만 자꾸 비는가"를 DuckDB에서 `query_events`로 바로 집계할 수 있게 하기 위함.

### 2.4 SourceArtifact 최소 공통 스키마 강화

지금 `lib/adapters/types.ts`의 `SourceArtifact`는 필드가 느슨하다. synthesis 품질과
dedupe / freshness 판단을 위해 다음은 **필수(non-optional)** 로 승격하거나 추가한다.

| 필드 | 현재 | 조정 후 | 이유 |
|---|---|---|---|
| `id` | 필수 | 유지 | — |
| `adapter` | 필수 | 유지 | fetcher 축과 일치 |
| `sourceType` | 필수 | 유지 | — |
| `title` | 필수 | 유지 | — |
| `url` | 필수 | → `canonicalUrl`로 개칭 + 필수 | query param 제거된 canonical form. dedupe 기준 |
| `snippet` | 필수 | 유지 | — |
| `content` | 필수 | 유지 (markdown 정규화 후) | — |
| `sourcePriority` | 필수 | 유지 | — |
| `publishedAt` | optional | 유지 | 일부 소스에서 unknown 가능 |
| `retrievedAt` | 없음 | **신규, 필수** | freshness & cache TTL 계산의 기준. ISO8601 |
| `language` | 없음 | **신규, 필수** | `ko | en | zh | ja | unknown`. synthesis 언어 처리용 |
| `fetcher` | metadata | **최상위 필수** | `metadata.fetcher`에서 중복이지만 필수 보증용 |
| `confidence` | 없음 | **신규, 필수** | `0.0 ~ 1.0`. 어댑터가 수집 성공에 대해 스스로 부여 |
| `rawRef` | 없음 | **신규, 필수** | 원본 payload 파일 경로 (다음 절 4.2 참조) |
| `metadata` | 필수 | 유지 | 예약 키는 위 2.3 준수 |

`canonicalUrl`은 어댑터 책임. URL normalization (trailing slash, utm_* 제거, fragment 제거)은
공통 util 하나로 추출.

```ts
// lib/adapters/url.ts (신규)
export function canonicalize(url: string): string { /* … */ }
```

---

## 3. 통합 대상 레포 맵핑

### 3.1 1차 레이어 (즉시 통합)

| 레포 | 위치 | Decision Engine에서의 역할 | 호출 경로 |
|---|---|---|---|
| **Scrapling** | `../git clone/Scrapling` | 일반 웹 + Cloudflare Turnstile 우회 fetcher | Python subprocess (MCP 서버 옵션도 있음) |
| **Agent-Reach** | `../git clone/Agent-Reach` | community/video 플랫폼 어그리게이터 | Python subprocess |
| **markitdown** | `../git clone/markitdown` | 모든 fetcher 출력 → markdown 정규화 | Python subprocess or markitdown-mcp |
| **opendataloader-pdf** | `../git clone/opendataloader-pdf` | PDF → Markdown + bounding box JSON | Node.js SDK (`@opendataloader/pdf`) |
| **reclip** | `../git clone/reclip` | 영상/오디오 다운로더 (1000+ 사이트) | CLI subprocess |

### 3.2 2차 레이어 (중기)

| 레포 | 역할 | 배치 |
|---|---|---|
| **CLIProxyAPI** | OpenAI/Gemini/Claude/Codex 통일 프록시 | 브리지 뒤에 놓고 `provider` 축을 n개로 확장 |
| **MiroFish** | 다중 에이전트 의견 집계/투표 | `orchestrator/consensus.ts` 신규 — contradictions 처리 단계 |
| **hermes-agent** | self-improving loop 참고 | insights 승격 알고리즘 업그레이드 레퍼런스 |

### 3.3 3차 레이어 (특수 상황)

| 레포 | 언제 쓰는가 |
|---|---|
| `superpowers` | 에이전트 skill 체계 — plan/verify 단계 정책 설계 |
| `agent-skill-manager` | 팀 공용 MCP skill 배포가 필요할 때 |
| `pi-autoresearch` | Decision Engine 자체를 자동 최적화하고 싶을 때 |
| `DEO-negation-aware-retrieval` | KB 검색 부정 표현 정확도 문제가 터졌을 때 |

---

## 4. 레이어별 설계

### 4.0 Adapter Selection Precedence

여러 어댑터가 동일 URL에 대해 `supports=true`일 때 오케스트레이터가 예측 불가능해지는 것을
막기 위해, 매칭 우선순위를 명시적으로 못 박는다. 현재 `run-research.ts`의 `Promise.all`은
"전부 병렬 실행"이므로, **라우팅 테이블**을 별도 레이어로 분리해서 "이 URL은 어느 어댑터가
primary인가"를 단일 책임으로 결정.

| URL 패턴 | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| `youtube.com`, `youtu.be` | agent-reach (자막) | reclip (다운로드 + STT) | — |
| `bilibili.com`, `b23.tv` | agent-reach | reclip | — |
| `reddit.com` | agent-reach | scrapling | — |
| `x.com`, `twitter.com` | agent-reach | scrapling | — |
| `github.com` | agent-reach | scrapling | — |
| `xiaohongshu.com` | agent-reach | scrapling (쿠키 제공 시) | — |
| 한국 커뮤 (`dcinside`, `arca.live`, `clien`, `fmkorea`, `ppomppu`) | scrapling | — | — |
| `.pdf` 확장자 또는 `content-type: application/pdf` | opendataloader-pdf | markitdown (fallback) | — |
| `arxiv.org/abs/*`, `arxiv.org/pdf/*` | opendataloader-pdf | agent-reach (meta만) | — |
| `r.jina.ai/*`, `s.jina.ai/*` | scrapling | markitdown | — |
| public feed (`/feed`, `/rss`, `*.xml`) | scrapling | markitdown | — |
| 그 외 일반 web | scrapling | markitdown (이미 HTML) | — |
| 동영상/오디오 URL 중 위에 없는 것 | reclip | — | — |

**구현 위치**: `lib/adapters/router.ts` (신규). `ResearchAdapter`에 `supports` 외에
`priority(plan, url) → number` 를 추가하는 대신, 라우터가 URL별로 단일 primary를 고르고
primary 실패 시 fallback을 순차 실행.

```ts
// lib/adapters/router.ts — 개념 스케치
export function routeUrl(url: string): AdapterChain {
  // { primary: "agent-reach", fallbacks: ["scrapling"] } 같은 체인 반환
}
```

Adapter 레이어 자체는 "무엇을 할 수 있는가(supports)"만 알고, "누가 먼저 하는가"는 라우터가
결정. 이 분리는 나중에 새 어댑터를 끼워넣어도 라우팅 정책만 고치면 되게 한다.

현재 1차 흡수 범위에서 `insane-search`는 플러그인 패키지로 넣지 않는다.
대신 엔진 policy에 아래 전략만 흡수한다.

- known public endpoint
- alternate URL / RSS / feed
- Jina reader mirror
- 이후 blocked-web fallback

### 4.1 Adapter 레이어

현재 기준 핵심 어댑터 4개는 모두 구현되어 있다.

```
lib/adapters/
├── types.ts              # SourceTarget에 "pdf" 추가
├── agent-reach.ts        # local Agent-Reach bridge
├── reclip.ts             # yt-dlp metadata/subtitle fallback
├── scrapling.ts          # Scrapling CLI escalation
├── opendataloader-pdf.ts # Node SDK 기반 PDF ingest
└── geocoding.ts          # (기존 유지)
```

#### 4.1.1 Scrapling 어댑터

**책임**: `sourceTargets`에 `"web"`이 있거나 `normalizedInput.urls`에 일반 웹 URL이 있을 때 실행.
Cloudflare Turnstile이 걸린 사이트에서도 HTML을 받아옴.

**현재 호출 형태**:
```ts
// lib/adapters/scrapling.ts
export function createScraplingAdapter(deps?: {
  exec?: ScraplingExecutor;
}): ResearchAdapter
```

**현재 동작**:
1. `scrapling extract get` 시도
2. 실패 시 `scrapling extract fetch`로 escalation
3. 보호/차단 계열이면 `scrapling extract stealthy-fetch --solve-cloudflare`로 escalation
4. 결과 HTML/TXT를 raw payload + normalized markdown로 저장
5. `metadata.bypass_level`에 `headers | headless | turnstile`를 태깅

**우회 정책**: Scrapling 기본 설정 이상으로 공격적인 설정(과도한 request-per-second, proxy rotation abuse 등)은 어댑터 레벨에서 옵트인으로만 허용.

#### 4.1.2 Agent-Reach 어댑터 (실구현)

현재는 local clone의 `agent_reach.channels.web.WebChannel.read()`를 Python bridge로 호출한다.
즉 Agent-Reach 패키지를 엔진에 넣는 것이 아니라, local repo의 zero-config web surface를 활용하는 상태다.
platform-specific search/read 분기는 아직 후속 범위다.

Agent-Reach가 지원 안 하는 한국 커뮤니티(디시·아카·클리앙 등)는 자동으로 **Scrapling fallback**.

#### 4.1.3 Reclip 어댑터 (실구현)

현재는 `reclip` web UI 서버를 띄우지 않고, `yt-dlp -J`를 직접 호출한다.
subtitle URL이 있으면 transcript를 우선 가져오고, 없으면 description으로 fallback 한다.
YouTube/Bilibili는 여전히 `agent-reach -> reclip` fallback 순서를 유지한다.

#### 4.1.4 OpenDataLoader-PDF 어댑터 (신규)

Node.js SDK (`@opendataloader/pdf`)가 있으므로 subprocess 없이 직접 import 가능.
Java 11+이 전제. 환경 프로브는 어댑터 초기화 시점에 한 번만.

```ts
// lib/adapters/opendataloader-pdf.ts
import { convert } from "@opendataloader/pdf";

export function createPdfAdapter(): ResearchAdapter {
  return {
    name: "opendataloader-pdf",
    supports(plan) {
      return plan.sourceTargets.includes("pdf") ||
             plan.normalizedInput.urls.some(u => /\.pdf($|\?)/i.test(u));
    },
    async execute(plan) {
      const pdfUrls = plan.normalizedInput.urls.filter(u => /\.pdf($|\?)/i.test(u));
      const results = await Promise.all(pdfUrls.map(async (url, i) => {
        const buf = await fetch(url).then(r => r.arrayBuffer());
        const out = await convert(Buffer.from(buf), {
          outputFormat: "markdown",
          includeBoundingBoxes: true,
          mode: "hybrid"   // OCR 포함
        });
        return toArtifact(out, url, i);
      }));
      return results;
    }
  };
}
```

### 4.2 정규화 레이어 (신규)

어댑터들이 각자 HTML/JSON/자막/PDF를 뱉으므로, 합의된 중간 포맷이 필요.
→ **markitdown**을 이 자리에 둔다.

```
lib/normalize/
├── markitdown.ts   # 🆕 어떤 입력이든 markdown 문자열로
├── raw-store.ts    # 🆕 raw payload 영속화
└── types.ts
```

어댑터 내부에서 content를 최종 artifact에 넣기 직전에 markitdown 통과.
단, markitdown이 이미 markdown인 입력을 넣으면 비용만 낭비되므로 `alreadyMarkdown` hint 제공.

**호출 방식 선택**: markitdown은 MCP 서버(`markitdown-mcp`)를 제공하므로 두 가지 모드 지원.
- `subprocess`: Decision Engine 서브프로세스로 호출 (default, 간단)
- `mcp`: 별도 구동 중인 markitdown-mcp에 JSON-RPC (병렬 처리 시 유리)

#### 4.2.1 Raw payload 보존 정책

markdown "only"로 일찍 고정하면 citation grounding, quote extraction, table recovery 같은
후속 처리가 망가진다. 정규화는 **derived view**로만 취급하고, **원본은 항상 raw-store에 병행
보존**한다.

**원칙**:
- human-facing: `SourceArtifact.content` (markdown, synthesis용)
- machine-facing: `rawRef`가 가리키는 원본 payload (inspection · re-processing용)

**저장 구조**:
```
workspace/{projectId}/runs/{runId}/raw/
├── <artifactId>.raw.html        # scrapling
├── <artifactId>.reach.json      # agent-reach
├── <artifactId>.transcript.json # reclip / agent-reach video
├── <artifactId>.pdf.bbox.json   # opendataloader-pdf (bounding box)
└── <artifactId>.pdf             # 원본 PDF 사본 (옵션, 용량 큰 경우 hash만)
```

`SourceArtifact.rawRef`는 이 파일의 workspace-relative 경로. 예: `raw/<artifactId>.raw.html`.

**크기 정책**:
- 일반 HTML / JSON: 원본 그대로 저장
- PDF 원본: 기본은 `sha256` 해시만 기록, 옵션으로 `--keep-pdf-raw`일 때만 사본
- 영상 파일(reclip): 저장 금지, transcript JSON만 보존. 영상 자체는 디스크 압박.

정규화 레이어가 제공하는 공식 API:
```ts
// lib/normalize/raw-store.ts
export async function saveRaw(
  runDir: string,
  artifactId: string,
  kind: "html" | "reach-json" | "transcript" | "pdf-bbox" | "pdf-source",
  payload: Buffer | string
): Promise<string /* rawRef */>;
```

### 4.3 Bridge 레이어 확장

현재 `cli-invoke.ts`가 `provider: "codex" | "claude"` 2개만 하드코딩.
→ **CLIProxyAPI**를 로컬 게이트웨이로 올려놓고 그 뒤에서 provider 축을 n개로.

```
lib/bridge/
├── cli-invoke.ts           # provider union 확장: codex | claude | gemini | proxy
├── proxy/
│   ├── cliproxy-client.ts  # 🆕 CLIProxyAPI REST 클라이언트
│   └── health.ts           # 🆕 /v1/health probe, 장애 시 direct fallback
```

advisory 파이프라인은 그대로 유지 (append-only). provider가 뭐가 됐든
`external_summary / suggested_next_actions / notes` 스키마 준수.

### 4.4 MCP 표면 확장

현재 MCP는 읽기 도구(`get_project`, `get_run`, `show_run_state` …) + bundle/ingest만 있음.
AI가 직접 "이 URL 가서 긁어와"가 안 됨. 다음 도구를 추가.

| 신규 MCP 도구 | 역할 | 어댑터 위임 |
|---|---|---|
| `fetch_web` | 일반 웹 한 페이지 수집 | scrapling |
| `fetch_community` | Reddit/Twitter/XHS 등 커뮤니티 포스트 | agent-reach → scrapling fallback |
| `fetch_video` | 유튜브/비리비리 자막·스크립트 | agent-reach → reclip fallback |
| `fetch_pdf` | PDF URL → markdown + bounding box | opendataloader-pdf |
| `normalize_doc` | 임의 입력 → markdown | markitdown |
| `gather_for_run` | run에 대해 모든 supports 어댑터 병렬 실행 | runResearch() 직접 호출 |

모든 도구의 출력은 `SourceArtifact[]` 또는 run에 직접 append된 결과 요약. 내부 decision은
여전히 overwrite 금지 — 수집만 제공.

### 4.5 합의 레이어 (2차, optional)

contradictions가 많은 run에서만 발동하는 선택적 단계.

```
lib/orchestrator/
├── consensus.ts   # 🆕 MiroFish 기반 다중 에이전트 투표
```

**발동 조건**: `synthesis.contradictions.length >= N` (기본 3).
**동작**: 동일 evidence를 서로 다른 프롬프트로 n회 돌려서 합의 라벨 추출.
**출력**: `consensus_label / agreement_ratio / dissent_summary`를 advisory에 append.

내부 decision은 이 결과를 참고하지만 덮어쓰지 않는다 (기존 원칙 유지).

---

## 5. 데이터 흐름 (4가지 소스 트랙)

### 5.1 Community 트랙
```
plan.urls: [reddit/twitter/디시 URL]
  → runResearch()
    → Agent-Reach adapter (reddit/twitter 지원)
    → Scrapling adapter (디시 같은 비지원 사이트)
  → markitdown normalize
  → SourceArtifact[sourceType="community"]
  → synthesizeEvidenceFromArtifacts
  → decision
```

### 5.2 Video 트랙
```
plan.urls: [youtube/bilibili URL]
  → Agent-Reach (자막 1순위)
    → 자막 없음 → reclip (다운로드 + 로컬 transcribe)
  → markitdown normalize
  → SourceArtifact[sourceType="video"]
```

### 5.3 PDF 트랙
```
plan.urls: [paper.pdf]
  → opendataloader-pdf adapter (hybrid 모드, OCR 포함)
  → markdown + bbox JSON
  → SourceArtifact[sourceType="pdf", metadata.ocr="yes|no"]
```

### 5.4 General Web (+blocked)
```
plan.urls: [일반 웹 / 차단된 사이트]
  → Scrapling adapter
    → 기본 PlayWrightFetcher
    → 차단 감지 → StealthyFetcher (Turnstile 우회)
  → markitdown normalize
  → SourceArtifact[sourceType="web", metadata.bypass_level="turnstile|headers|none"]
```

---

## 6. 구현 순서 (단계별 마일스톤)

### Milestone 1 — "AI가 진짜로 긁어올 수 있게" (1주 수준)

실행 순서(확정):

1. `SourceTarget += "pdf"` + `SourceArtifact` 필수 필드 확장 +
   metadata 예약 키(fetch_status / block_reason 포함) 정의
2. `adapters/url.ts`, `adapters/router.ts` 뼈대 + `tests/adapters/router.test.ts`
3. `adapters/scrapling.ts` 신규 구현 (fetch_status / block_reason 채움)
4. `adapters/agent-reach.ts` 실구현으로 교체 (placeholder 제거)
5. `normalize/markitdown.ts` + `normalize/raw-store.ts` 추가,
   3개 어댑터가 rawRef 채우도록 통합
6. `run-research.ts`를 router 기반으로 재작성 + 3단 budget 적용
7. MCP 최소 수집 도구 2개: `fetch_web`, `gather_for_run`

→ 이 시점에서 이미 "AI 명령 한 줄 → 진짜 수집"은 동작.
→ 동시에 실패 원인 진단(fetch_status/block_reason), raw 보존, 예산 분리까지 확보되어
   Milestone 2에서 PDF/reclip 붙여도 회귀 위험이 낮다.

### Milestone 2 — "소스 다양성" (다음 1주)
1. `adapters/opendataloader-pdf.ts` 추가
2. `adapters/reclip.ts` extractor 실구현
3. MCP 도구 확장: `fetch_pdf`, `fetch_video`, `fetch_community`
4. Agent-Reach 플랫폼 라우팅 테이블 정비 (한국 커뮤 → Scrapling fallback)

### Milestone 3 — "다중 공급자 & 합의" (중기)
1. CLIProxyAPI 로컬 구동 + `bridge/proxy/cliproxy-client.ts`
2. `cli-invoke.ts` provider union 확장
3. `orchestrator/consensus.ts` — MiroFish 옵션 적용
4. contradictions 자동 투표 파이프라인

### Milestone 4 — "자기 강화" (장기, 선택)
1. `pi-autoresearch` 스타일의 Decision Engine 자체 튜닝 루프
2. `hermes-agent` 참고해서 skill/insight self-improvement
3. `agent-skill-manager`로 팀 공용 MCP 배포

---

## 7. 테스트 전략

### 7.1 어댑터별 단위 테스트
각 어댑터는 `exec` / `extract` / `convert` 함수를 **DI로 주입**받게 되어 있으므로,
네트워크 없이 stub 주입으로 단위 테스트 가능. 기존 `tests/` 패턴 유지.

```ts
// tests/adapters/scrapling.test.ts 예시
const fakeExec: ScraplingExecutor = async () => ({
  stdout: JSON.stringify({ items: [mockArtifact] }),
  stderr: "", exitCode: 0
});
const adapter = createScraplingAdapter({ exec: fakeExec });
```

### 7.2 통합 스모크 테스트
`scripts/smoke/gather_all_sources.ts`를 하나 만들어서
4개 트랙 각각 1 URL씩 넣고 endpoint-up 검증만 수행.
실제 네트워크 호출이라 CI에는 포함 안 함 (`pnpm smoke:network`).

### 7.3 회귀 가드
기존 3개 어댑터가 placeholder에서 실구현으로 바뀌므로,
orchestrator 테스트에서 어댑터 결과를 mock으로 주입하는 경로를 유지.
`executeResearchRun(projectId, runId, { gather: async () => [...] })` 이미 존재.

---

## 8. 운영 & 주의사항

### 8.1 ToS / 법적 경계
기술적으로 긁을 수 있는 것과 긁어도 되는 것은 다름. 어댑터 레벨에서 다음 기본값 고정.

- **Rate limit**: Agent-Reach / Scrapling 둘 다 기본 1 req/s per host, burst 3.
- **Proxy rotation**: 기본 off. 명시적 config 옵트인.
- **Login 우회**: 로그인 강제 사이트(샤오홍슈, 네이버 카페 등)는 `metadata.login_required="true"` 태깅.
  자동 인증 우회는 어댑터가 하지 않음 — 사용자가 쿠키를 제공하는 형태로만 지원.
- **Robots.txt**: Scrapling은 respect 기본값. 무시 옵션은 config로만.

### 8.2 비용 / 시간 예산 — 3단 budget 구조

전역 예산 하나만 두면 비싼 어댑터 하나(reclip 다운로드 같은 것)가 전체 예산을 다 먹는
사태가 생긴다. 따라서 **total run / per-adapter / per-url** 3단으로 분리한다. fallback은
남은 예산 내에서만 동작.

```ts
// run.metadata.budget (신규)
{
  "total_ms":           600_000,   // 전체 run 상한 (10분)
  "per_adapter_ms": {
    "scrapling":         30_000,
    "agent-reach":       20_000,
    "reclip":           120_000,   // 비싸서 가장 큼
    "opendataloader-pdf": 60_000,
    "markitdown":        10_000
  },
  "per_url_ms":         45_000,    // 같은 URL에 primary + fallback 합 상한
  "fallback_budget_ratio": 0.4     // per_url_ms 중 fallback에 할당할 비율
}
```

**실행 규칙**:
1. 어댑터 단일 호출은 `per_adapter_ms` 초과 시 즉시 kill → `fetch_status = "timeout"`
2. 동일 URL에 primary 실패로 fallback 진입 시, 남은 예산 = `per_url_ms × fallback_budget_ratio`
3. `total_ms` 소진 임박 시 아직 시작 안 한 어댑터는 skip → `fetch_status = "partial"` 로 run 종료
4. **부분 결과는 버리지 않는다**. synthesis는 수집된 artifact만으로 진행.

**reclip 특수 처리**: reclip은 다운로드를 포함해 가장 비싸므로 라우팅 규칙상 **primary로 직접
선택되지 않고 오직 fallback으로만** 발동하는 것을 디폴트로. 예산도 fallback slot에서 차감.

**어댑터 기본 timeout** (참고, `per_adapter_ms`가 비었을 때 fallback 값):
- `scrapling`: 30s (turnstile 대기 포함)
- `agent-reach`: 20s per platform call
- `reclip`: 120s (다운로드 포함 가능)
- `opendataloader-pdf`: 60s (OCR 포함 시)
- `markitdown`: 10s

### 8.3 캐시
`workspace/{projectId}/cache/` 아래 URL 해시 기반 캐시. 기본 TTL:
- community: 6h
- video transcript: 30d
- pdf: 무제한 (컨텐츠 해시 일치 시)
- general web: 1h

### 8.4 MCP 보안
새 MCP 도구는 evidence 수집만 할 수 있고, decision/insight overwrite는 여전히 금지.
`fetch_*` 도구의 return 값은 run에 직접 write 하지 않고 candidate로만 append.

---

## 9. 파일 변경 요약 (체크리스트)

```
research/
├── lib/
│   ├── adapters/
│   │   ├── types.ts              # [수정] SourceTarget += "pdf",
│   │   │                         #        SourceArtifact 필수 필드 확장
│   │   │                         #        (canonicalUrl/retrievedAt/language/
│   │   │                         #         confidence/rawRef/fetcher)
│   │   ├── url.ts                # [신규] URL canonicalize 유틸
│   │   ├── router.ts             # [신규] URL → adapter chain 라우팅
│   │   ├── agent-reach.ts        # [재구현] placeholder 제거
│   │   ├── reclip.ts             # [보강] 기본 extractor 구현, fallback-only
│   │   ├── scrapling.ts          # [신규]
│   │   └── opendataloader-pdf.ts # [신규]
│   ├── normalize/
│   │   ├── markitdown.ts         # [신규]
│   │   ├── raw-store.ts          # [신규] raw payload 병행 저장
│   │   └── types.ts              # [신규]
│   ├── bridge/
│   │   ├── cli-invoke.ts         # [수정] provider union 확장
│   │   └── proxy/
│   │       ├── cliproxy-client.ts # [신규]
│   │       └── health.ts          # [신규]
│   ├── orchestrator/
│   │   ├── run-research.ts       # [수정] router 사용으로 교체,
│   │   │                         #        3단 budget 적용
│   │   └── consensus.ts          # [신규, Milestone 3]
│   └── mcp/
│       └── server.ts             # [수정] fetch_* 도구 추가
├── scripts/
│   └── smoke/
│       └── gather_all_sources.ts # [신규]
├── tests/
│   └── adapters/
│       ├── router.test.ts        # [신규] 우선순위 규칙 회귀
│       ├── scrapling.test.ts     # [신규]
│       ├── agent-reach.test.ts   # [수정]
│       ├── reclip.test.ts        # [수정]
│       └── opendataloader-pdf.test.ts # [신규]
└── docs/
    ├── INTEGRATION_ARCHITECTURE.md # (이 문서)
    ├── CLI_SPEC.md               # [수정] fetch_* MCP 도구 명세 추가
    └── SCHEMA.md                 # [수정] metadata 예약 키 + Artifact 필수
                                  #        필드 + raw payload 경로 규약 문서화
```

---

## 10. 다음 액션 후보

1. 이 설계대로 **Milestone 1 착수** — Scrapling + Agent-Reach 실구현부터.
2. **타입 확장 먼저** — `SourceTarget += "pdf"`, metadata 예약 키 정의만 PR 분리.
3. **MCP 도구 표면 먼저** — `fetch_web`, `gather_for_run`만 뚫어서 AI가 체감하게.
4. **CLIProxyAPI 먼저** — 모델 공급자 다양성부터 확보.

원하는 경로 선택 후 실제 코드 작성으로 넘어가면 됨.
