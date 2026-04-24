#!/usr/bin/env python3
"""
PACK-001 auditor prompt dry-run runner.

Optional API-backed dry-run runner.

Sends the auditor prompt + handoff.json payload to the OpenAI API and
validates the response against the 5 dry-run invariants defined in
eval/fixtures/dry-run/README.md. Self-audit remains the default audit mode;
this script exists only for the optional deeper API-audit path.

Usage:
    export OPENAI_API_KEY=sk-...
    export OPENAI_MODEL=gpt-5-<pinned-snapshot>   # e.g. gpt-5-2025-11-20
    python3 run_dryrun.py

    # Self-audit/manual mode: verify an already captured raw response
    python3 run_dryrun.py --verify-only output/audit-output-raw-<stamp>.txt

Exit codes:
    0 — all invariants passed
    1 — response is not strict JSON
    2 — required report fields missing or malformed
    3 — identifying information leaked into anonymizedWorstK or elsewhere
    4 — auditFooter.modelVersionOrDate missing or placeholder
    5 — histogram does not match expected failure modes
    6 — API call failed (network / auth / quota)
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import urllib.request
    import urllib.error
except ImportError:
    print("stdlib urllib missing — cannot proceed", file=sys.stderr)
    sys.exit(6)

HERE = Path(__file__).resolve().parent
PROMPT_PATH = HERE / "auditor-prompt.md"
HANDOFF_PATH = HERE / "handoff.json"
OUTPUT_DIR = HERE / "output"

ALLOWED_CATEGORIES = {
    "retrieval-insufficient",
    "authority-substitution",
    "false-convergence",
    "false-balance",
    "schema-violation",
    "cost-overrun",
    "other",
}

EXPECTED_HISTOGRAM = {
    "authority-substitution": 1,
    "retrieval-insufficient": 1,
    "false-convergence": 1,
}
EXPECTED_PACK_LEVEL = "fail"
EXPECTED_WORST_K_LEN = 3  # all 3 failures should surface

PLACEHOLDER_VERSION_STRINGS = {"", "latest", "unknown", "none", "null"}


def die(code: int, msg: str) -> None:
    print(f"[dry-run FAIL code={code}] {msg}", file=sys.stderr)
    sys.exit(code)


def load_inputs() -> tuple[str, dict[str, Any]]:
    prompt = PROMPT_PATH.read_text(encoding="utf-8")
    handoff = json.loads(HANDOFF_PATH.read_text(encoding="utf-8"))
    return prompt, handoff


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="PACK-001 dry-run verifier")
    parser.add_argument(
        "--verify-only",
        metavar="RAW_RESPONSE_PATH",
        help="skip API call and verify an existing raw auditor response file",
    )
    return parser.parse_args()


def call_gpt5(prompt: str, handoff: dict[str, Any]) -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        die(6, "OPENAI_API_KEY not set")

    model = os.environ.get("OPENAI_MODEL")
    if not model:
        die(6, "OPENAI_MODEL not set (pass a pinned snapshot, e.g. gpt-5-YYYY-MM-DD)")

    # Use Chat Completions API for broad compatibility; the runner does not
    # depend on Responses-API-specific fields.
    url = "https://api.openai.com/v1/chat/completions"
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": "Here is the handoff payload for audit. Produce the JSON report per the schema above.\n\n"
                + json.dumps(handoff, ensure_ascii=False),
            },
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0,
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        die(6, f"HTTP {e.code}: {detail[:400]}")
    except urllib.error.URLError as e:
        die(6, f"network error: {e}")
    except Exception as e:  # noqa: BLE001
        die(6, f"unexpected API error: {e}")

    try:
        return payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        die(6, f"malformed API envelope: {e}; keys={list(payload.keys())}")
        return ""  # unreachable


def validate_strict_json(raw: str) -> dict[str, Any]:
    stripped = raw.strip()
    if not stripped.startswith("{"):
        die(1, f"response does not start with '{{': first 80 chars = {stripped[:80]!r}")
    if not stripped.endswith("}"):
        die(1, f"response does not end with '}}': last 80 chars = {stripped[-80:]!r}")
    try:
        obj = json.loads(stripped)
    except json.JSONDecodeError as e:
        die(1, f"JSON decode failed: {e}")
    if not isinstance(obj, dict):
        die(1, f"top-level is not an object, got {type(obj).__name__}")
    return obj


def validate_shape(report: dict[str, Any]) -> None:
    required = {"packLevelPassFail", "failureCategoryHistogram", "anonymizedWorstK", "auditFooter"}
    missing = required - set(report.keys())
    if missing:
        die(2, f"required fields missing: {sorted(missing)}")

    if report["packLevelPassFail"] not in {"pass", "fail"}:
        die(2, f"packLevelPassFail invalid: {report['packLevelPassFail']!r}")

    hist = report["failureCategoryHistogram"]
    if not isinstance(hist, dict):
        die(2, f"failureCategoryHistogram must be object, got {type(hist).__name__}")
    for k, v in hist.items():
        if k not in ALLOWED_CATEGORIES:
            die(2, f"unknown failure category: {k!r}")
        if not isinstance(v, int) or v < 1:
            die(2, f"histogram value for {k!r} must be positive int, got {v!r}")

    worst = report["anonymizedWorstK"]
    if not isinstance(worst, list):
        die(2, f"anonymizedWorstK must be list, got {type(worst).__name__}")
    if len(worst) > 3:
        die(2, f"anonymizedWorstK length {len(worst)} exceeds k=3")
    for i, entry in enumerate(worst):
        if not isinstance(entry, dict):
            die(2, f"worstK[{i}] not object: {entry!r}")
        allowed_keys = {"failureCategory", "axisCoordinates"}
        extra = set(entry.keys()) - allowed_keys
        if extra:
            die(2, f"worstK[{i}] has forbidden extra keys: {sorted(extra)}")
        if entry.get("failureCategory") not in ALLOWED_CATEGORIES:
            die(2, f"worstK[{i}] failureCategory invalid")
        ax = entry.get("axisCoordinates")
        if not isinstance(ax, dict):
            die(2, f"worstK[{i}] axisCoordinates not object")
        expected_axes = {"language", "genre", "recency", "disputedness", "doc-density"}
        if set(ax.keys()) != expected_axes:
            die(2, f"worstK[{i}] axis keys mismatch: {sorted(ax.keys())}")

    footer = report["auditFooter"]
    if not isinstance(footer, dict):
        die(2, f"auditFooter must be object")
    for k in ("provider", "model", "modelVersionOrDate", "auditTimestamp"):
        if k not in footer:
            die(2, f"auditFooter missing field: {k}")


def validate_no_leaks(raw: str, handoff: dict[str, Any]) -> None:
    forbidden: list[str] = []

    for topic in handoff["topics"]:
        forbidden.append(topic["id"])
        # Query tokens of 6+ chars that are distinctive
        for tok in re.findall(r"[A-Za-z0-9/]{6,}", topic["query"]):
            # skip common words
            if tok.lower() in {"experience", "production", "structure", "concurrency", "standard", "backend"}:
                continue
            forbidden.append(tok)
        for artifact in topic["bundle"]["artifacts"]:
            forbidden.append(artifact["url"])
            forbidden.append(artifact["host"])
        for claim in topic["bundle"]["claims"]:
            # Distinctive phrases (>=20 chars) from the claim text
            claim_text = claim["text"]
            for phrase in re.findall(r"[^.]{30,}", claim_text):
                forbidden.append(phrase.strip())

    # The auditor's response is expected to describe only axisCoordinates, not content.
    hits: list[str] = []
    raw_lower = raw.lower()
    for needle in forbidden:
        if not needle:
            continue
        if needle.lower() in raw_lower:
            hits.append(needle)

    if hits:
        sample = hits[:5]
        die(3, f"identifying info leaked into response: {len(hits)} hits, sample={sample}")


def validate_footer_version(report: dict[str, Any]) -> None:
    ver = (report["auditFooter"].get("modelVersionOrDate") or "").strip()
    if ver.lower() in PLACEHOLDER_VERSION_STRINGS:
        die(4, f"auditFooter.modelVersionOrDate is placeholder: {ver!r}")


def validate_expected_histogram(report: dict[str, Any]) -> None:
    if report["packLevelPassFail"] != EXPECTED_PACK_LEVEL:
        die(5, f"packLevelPassFail expected {EXPECTED_PACK_LEVEL!r}, got {report['packLevelPassFail']!r}")
    hist = report["failureCategoryHistogram"]
    for cat, expected_count in EXPECTED_HISTOGRAM.items():
        if hist.get(cat) != expected_count:
            die(
                5,
                f"histogram[{cat!r}] expected {expected_count}, got {hist.get(cat)}; full histogram = {hist}",
            )
    extra = set(hist.keys()) - set(EXPECTED_HISTOGRAM.keys())
    if extra:
        die(5, f"unexpected categories in histogram: {sorted(extra)}")

    # Exact-length check for anonymizedWorstK. The fixture is designed so
    # that exactly 3 topics fail, which should saturate worst-k=3. A shorter
    # list means the auditor dropped entries or mis-truncated; a longer list
    # is already caught by validate_shape (> 3 is rejected there).
    worst_len = len(report["anonymizedWorstK"])
    if worst_len != EXPECTED_WORST_K_LEN:
        die(
            5,
            f"anonymizedWorstK length expected {EXPECTED_WORST_K_LEN}, got {worst_len}",
        )


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    args = parse_args()

    prompt, handoff = load_inputs()
    print(f"[dry-run] prompt={PROMPT_PATH.name} bytes={len(prompt)}", file=sys.stderr)
    print(f"[dry-run] handoff topics={len(handoff['topics'])}", file=sys.stderr)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    if args.verify_only:
        raw_path = Path(args.verify_only).resolve()
        raw = raw_path.read_text(encoding="utf-8")
        parsed_path = OUTPUT_DIR / f"audit-output-verified-{stamp}.json"
        print(f"[dry-run] verify-only raw={raw_path}", file=sys.stderr)
    else:
        t0 = time.time()
        raw = call_gpt5(prompt, handoff)
        elapsed_ms = int((time.time() - t0) * 1000)
        print(f"[dry-run] API call returned in {elapsed_ms}ms, bytes={len(raw)}", file=sys.stderr)
        raw_path = OUTPUT_DIR / f"audit-output-raw-{stamp}.txt"
        parsed_path = OUTPUT_DIR / f"audit-output-{stamp}.json"
        raw_path.write_text(raw, encoding="utf-8")

    report = validate_strict_json(raw)
    parsed_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    validate_shape(report)
    validate_no_leaks(raw, handoff)
    validate_footer_version(report)
    validate_expected_histogram(report)

    print(f"[dry-run OK] raw={raw_path.name} parsed={parsed_path.name}", file=sys.stderr)
    print(f"[dry-run OK] packLevelPassFail={report['packLevelPassFail']}", file=sys.stderr)
    print(f"[dry-run OK] histogram={report['failureCategoryHistogram']}", file=sys.stderr)
    print(f"[dry-run OK] worstK.len={len(report['anonymizedWorstK'])}", file=sys.stderr)
    print(f"[dry-run OK] footer.modelVersionOrDate={report['auditFooter']['modelVersionOrDate']!r}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
