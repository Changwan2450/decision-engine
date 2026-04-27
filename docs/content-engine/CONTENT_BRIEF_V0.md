# Content Brief v0

Content Brief v0 is a production packet for YouTube longform planning. It is not a generic research report. It turns evidence state and optional imported notes into video-specific decisions.

## Inputs

### `bundle.json`

Decision Engine export. Preferred source for:

- Operator Brief
- evidence diagnostics
- repair attempts
- evidence replay
- strongest evidence
- unresolved gaps
- overclaim warnings

### `report.md`

Optional manually imported report from Deep Research, Perplexity, Claude, or an operator.

V0 rule: treat it as imported and unverified unless specific claims are mapped to checked sources.

### `sources.json`

Optional source list.

Suggested shape:

```json
[
  {
    "title": "Source title",
    "url": "https://example.com",
    "source_type": "official|primary|analysis|community|unknown",
    "checked": false,
    "notes": ""
  }
]
```

### `notes.md`

Optional editor/operator notes. These may guide angle and story, but they are not evidence by themselves.

## Outputs

- `content_brief.json`
- `title_candidates.md`
- `hook_candidates.md`
- `script_outline.md`
- `risk_flags.md`
- `production_next_actions.md`

## `content_brief.json` Schema

```json
{
  "topic": "string",
  "target_audience": "string",
  "platform": "string",
  "video_length": "string",
  "viewer_anxiety": ["string"],
  "core_emotion": "string",
  "content_angle": "string",
  "why_now": "string",
  "core_conflict": "string",
  "video_promise": "string",
  "key_claims": [
    {
      "claim": "string",
      "content_use": "opening|context|turning_point|risk|takeaway",
      "evidence_status": "verified|needs_verification|imported_unverified|illustrative",
      "confidence": "low|medium|high",
      "source_notes": ["string"],
      "overclaim_warning": "string"
    }
  ],
  "evidence_status": {
    "source_mode": "decision_engine|manual_import|mixed|draft",
    "imported_unverified": true,
    "has_official_or_primary_evidence": false,
    "counterevidence_checked": false,
    "false_convergence_risk": "unknown|true|false",
    "overall_confidence": "low|medium|high",
    "notes": ["string"]
  },
  "title_candidates": [
    {
      "title": "string",
      "angle": "anxiety|reality_check|family_burden|money_retirement|social_structure",
      "risk": "low|medium|high",
      "note": "string"
    }
  ],
  "hook_candidates": [
    {
      "hook": "string",
      "style": "question|scene|contrast|myth_bust|viewer_address",
      "risk": "low|medium|high",
      "note": "string"
    }
  ],
  "story_structure": [
    {
      "section": "opening|problem_setup|reality_examples|structural_explanation|conflict_tension|viewer_takeaway|closing",
      "target_duration": "string",
      "purpose": "string",
      "beats": ["string"]
    }
  ],
  "risk_flags": [
    {
      "risk": "string",
      "severity": "low|medium|high",
      "mitigation": "string"
    }
  ],
  "follow_up_videos": ["string"],
  "source_notes": ["string"],
  "overclaim_warnings": ["string"],
  "production_next_actions": ["string"]
}
```

## Trust Rules

- Do not present imported report claims as verified.
- Do not provide personal financial advice.
- Do not claim pension, welfare, or housing facts without checking current official sources.
- Do not frame middle-aged viewers as failures.
- Do not turn generational conflict into blame content unless the evidence supports the claim.
- Do not hide evidence gaps.
