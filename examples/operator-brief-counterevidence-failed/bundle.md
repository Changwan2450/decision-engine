# Decision Engine Demo Bundle

## Operator Brief

- Headline: unclear / not_ready: the result is not ready because counterevidence discovery failed and official/primary evidence is missing.
- Status: not_ready
- Decision summary: unclear (low): evidence gaps remain.

### Evidence Status

- Decisiveness: 0.5
- False convergence risk: true
- Official/primary evidence: false
- Counterevidence checked: false
- Weak evidence: true

### Repair Outcomes

- Source coverage: no_candidates (0 followed)
- Counterevidence: failed_discovery (0 followed)
- Failed follow attempts: 0

### Strongest Evidence

- [analysis/internal] KB Wiki Prior — https://kb.local/wiki/demo-counterevidence-failed
- [analysis/internal] Decision History Prior — https://kb.local/decision-history/demo-counterevidence-failed

### Unresolved Gaps

- no_official_or_primary_evidence
- support_only_evidence
- counterevidence_not_checked
- weak_evidence
- false_convergence_risk
- source_coverage_no_candidates
- counterevidence_failed_discovery

### Next Actions

- Collect or repair official/primary evidence before using this result.
- Do not treat the conclusion as settled; rerun with stronger counterevidence/source coverage.
- Retry counterevidence check or use a different discovery source.
- Retry source coverage discovery or provide seed official sources.

### AI Handoff

- Inspect Operator Brief first, then Evidence Diagnostics, Repair Attempts, and Evidence Replay.
- Use strongestEvidence and citations; do not use failedFollowAttempts as evidence.

### Do Not Overclaim

- Do not claim the conclusion is settled while falseConvergenceRisk is true.
- Do not claim counterevidence was checked if counterevidenceChecked is false or repair failed.
- Do not treat limitations/risks as contradictions unless contradiction records exist.

## Evidence Diagnostics

- Decisiveness: 0.5
- False convergence risk: true
- Counterevidence checked: false
- Weak evidence: true
- Official/primary evidence: false
- Warnings: no_official_or_primary_evidence

## Repair Attempts

### Source Coverage Repair

- Attempted: yes
- Outcome: no_candidates
- Discovery source: domain_targeted_search
- Discovery candidates: 1
- Discovery allowed URLs: 0
- Discovery raw results: 1
- Discovery errors: search_results_unavailable, http_status_202
- Followed evidence count: 0
- Failed follow attempts: 0

### Counterevidence Repair

- Attempted: yes
- Outcome: failed_discovery
- Reasons: false_convergence_risk
- Query count: 2
- Candidate count: 0
- Allowed URL count: 0
- Discovery errors: search_results_unavailable, http_status_202
- Followed evidence count: 0
- Failed follow attempts: 0

## Evidence Replay

### Source Quality Summary

- Artifacts: 14
- Claims: 18
- Citations: 12
- Contradictions: 0
- Retrieval failures: 5
- Official/primary evidence: false
- Weak evidence: true
- False convergence risk: true

### Retrieval Failures

- blocked — Search mirror — https://s.jina.ai/?q=demo

### Unresolved Evidence Gaps

- no_official_or_primary_evidence
- counterevidence_not_checked
- weak_evidence
- false_convergence_risk
