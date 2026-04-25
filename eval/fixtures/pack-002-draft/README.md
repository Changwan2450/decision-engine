# PACK-002 Draft Dry-Run Fixtures

Hand-authored deterministic fixtures for `pack-002.draft.yaml`.

These fixtures do not call retrieval, adapters, LLMs, or the network. They
exercise the acceptance fields declared by the PACK-002 draft skeleton.

Fixture count: 11 JSON files.

- p2-01 pass/fail: source-class blindness
- p2-02 pass/fail: aggregator dominance
- p2-03 pass/fail: decisiveness blind spot
- p2-04 pass/fail: false convergence
- p2-05 shared runA + pass/fail runB: N+1 reuse gap
