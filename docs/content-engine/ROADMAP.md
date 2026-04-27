# Content Research Engine Roadmap

## 1. Product Thesis

Content Research Engine turns research into content-production decisions.

It is not a generic Deep Research replacement. It is not trying to win on broad search quality. It wins by converting research state and audience reaction signals into production-ready content packets.

The core output is not a report. The core output is a packet that helps decide:

- content angle
- viewer anxiety
- title
- hook
- story structure
- risk and overclaim boundaries
- production next actions

## 2. Build vs Use Rule

Build:

- Content Brief generation
- Persona reaction mapping
- title, hook, and story decisions
- risk and overclaim flags
- production next actions
- upload feedback loop later

Use upstream:

- Deep Research
- Perplexity
- Claude reports
- manual reports
- decision-engine bundles
- source lists

Do not build yet:

- generic search engine
- broad crawler
- Deep Research clone
- ChatGPT UI scraping
- Deep Research API integration
- TTS/BGM/video automation
- ffmpeg editor
- YouTube upload automation
- perfect citation parser
- large monorepo restructure

## 3. Component Roles

### decision-engine

decision-engine is the frozen research/evidence core for now.

It produces:

- Operator Brief
- Evidence Diagnostics
- Repair Attempts
- Evidence Replay

It should not be expanded generically unless content dogfood proves a specific need.

### Persona Engine

Persona Engine is the reaction testing layer.

It tests:

- titles
- hooks
- conflict
- comment triggers
- objections
- retention risks

Script Engine is draft-only and is not the production script writer yet.

### Deep Research

Deep Research is an optional upstream research provider.

Use it through the existing ChatGPT plan or manual export. Do not add API dependency in v0. Do not scrape the ChatGPT UI.

Imported reports should be treated as `imported_unverified` unless verified against evidence.

### Content Engine

Content Engine owns:

- `content_brief.json`
- title, hook, story, risk, and production packet
- content-specific workflow

## 4. Target Content Direction

Audience:

- Korean middle-aged and senior viewers
- roughly 45-65
- adult children who care about parents' retirement and family burden

Topic lane:

- money
- retirement
- pension
- welfare
- housing
- family burden
- work after retirement
- generational conflict
- life-politics and social-economic explanations

Position:

- not political agitation
- not financial advice
- not fearmongering
- social-economic life explanation channel

## 5. First Pilot

Topic:

```text
50대가 은퇴를 못 하는 진짜 이유
```

Goal:

Produce one 8-12 minute YouTube longform pilot.

Required artifacts:

- research input or decision-engine bundle
- `content_brief.json`
- `persona_test.json`
- `title_candidates.md`
- `hook_candidates.md`
- `thumbnail_lines.md`
- `script_outline.md`
- `risk_flags.md`
- `production_next_actions.md`
- `final script.md` later

Definition of done:

A human can write and produce an 8-12 minute video from the packet.

## 6. Workflow v0

1. Pick topic.
2. Gather research with decision-engine or Deep Research/manual report.
3. Create Content Brief.
4. Run Persona Reaction Test.
5. Refine title, hook, and story.
6. Write script outline.
7. Human writes/edits final script.
8. Produce simple video manually or semi-manually.
9. Upload private/unlisted.
10. Record metrics manually.
11. Feed metrics into next brief later.

## 7. Success Criteria

The content engine is useful only if:

- it produces better video decisions than a plain research report
- title, hook, and story choices are clearer
- persona objections and comment triggers are visible
- risk flags prevent overclaiming
- a human can move from packet to script quickly
- the first pilot can be produced without building full automation

## 8. Stop Conditions

Stop or pivot if:

- Content Brief is not more useful than plain Deep Research output
- Persona Engine reactions do not improve title or hook decisions
- the packet is too generic to write a video from
- workflow keeps drifting back into generic search/research infrastructure
- too much effort goes into automation before one video is produced

## 9. Next 3 Concrete Tasks

1. Commit this `ROADMAP.md` direction lock.
2. Dogfood the retirement pilot packet and produce `persona_test.json`.
3. Refine title, hook, story, and `script_outline.md` from persona feedback.

## 10. Future Phases

Phase 1:

- Content Brief v0 + retirement pilot packet

Phase 2:

- Persona Bridge v0

Phase 3:

- Manual 8-12 minute pilot video

Phase 4:

- Upload feedback loop

Phase 5:

- Only then consider TTS/BGM/video automation

## 11. Anti-Drift Checklist

Before starting any new feature, ask:

- Does this help produce the first video?
- Does this improve title, hook, story, risk, or persona decisions?
- Can Deep Research or an existing tool do this already?
- Is this generic research infrastructure creep?
- Can this wait until after one pilot video?
