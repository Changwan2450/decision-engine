# Persona Bridge v0

Persona Bridge v0 maps a content brief into the existing Persona Engine without changing Persona Engine internals.

## Boundary

Persona Engine is the reaction testing layer.

It should test:

- title candidates
- hook candidates
- content angle
- story tension
- likely objections
- tone risk
- comment triggers

It should not be treated as a factual research engine or a guaranteed view predictor.

## Do Not Change In V0

- Do not change `persona_engine/` internals.
- Do not change playbook logic unless a specific content dogfood requires it later.
- Do not use Script Engine as the main longform script generator yet.
- Script Engine is draft-only for this workflow.

## Mapping To `TopicCard`

Current Persona Engine `TopicCard` fields:

```json
{
  "id": "string",
  "title": "string",
  "situation": "string",
  "source_type": "manual",
  "domain_hint": "money",
  "conflict_hint": ["string"],
  "target": "string",
  "safety_notes": ["string"]
}
```

### Title Mapping

Use the strongest title candidate or the current working title:

```text
content_brief.title_candidates[0].title -> TopicCard.title
```

If no title candidate is selected, use `content_brief.topic`.

### Situation Mapping

Build a compact situation from:

- `content_angle`
- `viewer_anxiety`
- `core_conflict`
- `story_structure` opening/problem beats
- major risk flags

The situation should describe the viewer tension, not claim that the research is complete.

### Target Mapping

```text
content_brief.target_audience -> TopicCard.target
```

For the first pilot:

```text
Korean viewers aged roughly 45-65, with retirement, family burden, housing, pension, and income anxiety.
```

### Domain Hint Mapping

Use `money` for the first pilot because the topic centers on retirement, income, family burden, housing, pension, and welfare pressure.

Current Persona Engine accepts:

- `workplace`
- `money`
- `dating`
- `auto`

### Safety Notes Mapping

Map risk flags and overclaim warnings into `safety_notes`.

Examples:

- Avoid personal financial advice.
- Verify pension and welfare facts before final script.
- Avoid blaming only children or only parents.
- Avoid unsupported claims about national retirement averages.

## Expected `persona_test.json`

```json
{
  "best_title": "string",
  "title_scores": [
    {
      "title": "string",
      "click_strength": 0,
      "trust_risk": "low|medium|high",
      "comment_potential": 0,
      "reason": "string"
    }
  ],
  "hook_score": {
    "best_hook": "string",
    "score": 0,
    "reason": "string"
  },
  "retention_risks": ["string"],
  "comment_triggers": ["string"],
  "tone_recommendation": "string",
  "persona_specific_objections": [
    {
      "persona_segment": "string",
      "objection": "string",
      "recommended_edit": "string"
    }
  ],
  "overclaim_sensitivity": ["string"],
  "recommended_edits": ["string"]
}
```

## Adapter Responsibilities

The bridge should:

- create `TopicCard` input from `content_brief.json`
- run Persona Engine separately
- normalize `reaction_report.json` into `persona_test.json`
- preserve the Persona Engine disclaimer
- keep factual uncertainty from the content brief visible

The bridge should not:

- rewrite factual claims
- invent evidence
- treat persona reactions as survey data
- treat a high hook score as truth
- generate the final longform script by itself
