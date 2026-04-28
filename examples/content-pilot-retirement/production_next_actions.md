# Production Next Actions

Pilot topic: `50대가 은퇴를 못 하는 진짜 이유`

## Research Next

1. Run or import research on Korean retirement age, labor participation, reemployment, household finance, pension, welfare, and housing costs.
2. Collect official or primary sources for pension and welfare facts.
3. Collect current data on middle-aged employment and household financial burden.
4. Find counterexamples: people who delay retirement by choice, preference, or identity rather than pressure.
5. Separate verified facts from illustrative story beats.

## Manual Verification

Before final script writing, verify:

- current pension eligibility and benefit language
- welfare support rules mentioned in the script
- current labor and reemployment data
- household debt or housing-cost claims
- any claim about “many,” “most,” “average,” or “typical”

## Persona Test

Persona Engine dogfood completed once with:

```bash
python3 -m persona_engine react --topic ../research/examples/content-pilot-retirement/persona_topic.json --n 24 --seed 42 --playbook money_conflict
```

Generated artifacts:

- `persona_topic.json`
- `persona_test.json`

Observed from `persona_test.json`:

- Baseline title remains `50대가 은퇴를 못 하는 진짜 이유`.
- Best usable hook is the question-style hook, but it needs longform rewriting.
- Generic viral hooks scored highly but should be rejected for this channel position.
- Main conflict axis came back as `현실주의 vs 자기만족`, which is useful but too narrow for the final story.
- Persona feedback exposed a retention risk: the outline needs concrete family burden, housing, and reemployment scenes early.

Next persona checks:

- Which title feels respectful but clickable.
- Whether hooks create recognition or panic.
- Whether middle-aged viewers feel blamed.
- Whether family-burden framing triggers useful comments or defensive reactions.
- Whether the tone is too political, too cold, or too advice-like.

Suggested `TopicCard` direction:

```json
{
  "title": "50대가 은퇴를 못 하는 진짜 이유",
  "situation": "50대 시청자가 은퇴를 생각하지만 생활비, 자녀 지원, 부모 돌봄, 주거비, 연금 불확실성 때문에 일을 계속해야 하는 상황을 다룬다.",
  "source_type": "manual",
  "domain_hint": "money",
  "target": "한국 45-65세 시청자",
  "safety_notes": [
    "개인 금융 조언처럼 말하지 말 것",
    "연금과 복지 사실은 공식 출처로 검증할 것",
    "세대 갈등을 자극하지 말 것",
    "공포 마케팅을 피할 것"
  ]
}
```

## Assets Needed

- Simple household budget visual.
- Timeline graphic: main job, reemployment, pension timing, family costs.
- Neutral B-roll: commute, small business, apartment exterior, family table, paperwork.
- Onscreen caveat card: “개별 상황은 반드시 공식 정보와 전문가 상담으로 확인하세요.”

## Before Final Script

1. Replace all unverified claims with checked facts or remove them.
2. Use the current baseline title unless another top-3 title wins in a second persona check.
3. Rewrite the selected hook into longform tone and avoid generic controversy phrasing.
4. Keep the video promise narrow: explain pressure, do not solve retirement.
5. Preserve the overclaim warnings in the script notes.
6. Draft the 8-12 minute script from the outline only after research and persona checks are complete.
