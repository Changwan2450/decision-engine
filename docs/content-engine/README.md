# Content Research Engine

This direction treats Decision Engine as a research/evidence core for content production.

The main product is not a generic research engine, a Deep Research clone, or a search engine. The goal is to turn research state into decisions that help produce a video: angle, title, hook, story, risk boundaries, and next production actions.

## Product Role

Content Research Engine combines three layers:

- Decision Engine: research/evidence state, diagnostics, source coverage, counterevidence status, Operator Brief.
- Persona Engine: reaction testing for title, hook, conflict, objections, tone, and comment triggers.
- Manual upstream reports: optional Deep Research, Perplexity, Claude, or operator notes imported as unverified inputs.

Deep Research is an upstream source, not the core engine. Imported reports should be marked as imported or unverified until their claims are checked against evidence.

## Build vs Use Rule

Build only the content-production layer:

- content brief generation
- persona reaction mapping
- title, hook, and story decisions
- risk and overclaim flags
- production next actions

Use existing tools as upstream inputs:

- Deep Research
- Perplexity
- Claude reports
- existing research reports
- manual source lists

Do not build yet:

- generic Deep Research replacement
- broad crawler
- search engine parity
- ChatGPT UI scraping
- Deep Research API integration
- full script automation
- TTS/BGM/video editing pipeline

## First Pilot

Pilot topic:

```text
50대가 은퇴를 못 하는 진짜 이유
```

Target audience:

```text
Korean middle-aged and senior viewers, roughly 45-65
```

Platform:

```text
YouTube longform, 8-12 minutes
```

The first packet should help a human produce a grounded Korean longform video without pretending the research is fully complete. It should make the emotional angle, evidence gaps, overclaim risks, title candidates, hook candidates, and production next actions explicit.

## Workflow V0

```text
research input
  -> content_brief.json
  -> Persona Engine reaction test
  -> title/hook/story refinement
  -> script outline
  -> production packet
```

V0 is semi-automatic. It is not a full video automation pipeline.

## What To Avoid

- No Deep Research API integration.
- No ChatGPT UI scraping.
- No full automation.
- No TTS/BGM/video pipeline.
- No ffmpeg editor.
- No YouTube upload automation.
- No generic search improvements.
- No repo split.
- No large monorepo restructure.
- No Script Engine rewrite as part of this packet.

## Current Output

The pilot packet lives under:

```text
examples/content-pilot-retirement/
```

It includes:

- `content_brief.json`
- `title_candidates.md`
- `hook_candidates.md`
- `script_outline.md`
- `risk_flags.md`
- `production_next_actions.md`
