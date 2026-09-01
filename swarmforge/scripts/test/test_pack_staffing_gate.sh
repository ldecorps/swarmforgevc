#!/usr/bin/env bash
# BL-1318: shell smoke tests for pack_staffing_gate_cli.bb — the thin fs
# adapter over pack_staffing_gate_lib.bb's pure seat-staffing-decision. The
# pure decision rule (matrix/gate/eligibility ordering, override, no-pin) is
# covered by pack_staffing_gate_lib_test_runner.bb; this file exercises the
# IO layer alone: runtime-registry vs committed-seed fallback, the
# scorecards/<provider>__<model>.json read convention, the NO_EVIDENCE
# marker line, and --override end to end. Mirrors test_model_factory_cli.sh's
# own MODEL_STEWARD_STATE_DIR isolation pattern — never mutates this repo's
# real .swarmforge/model-steward/.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI="$ROOT/swarmforge/scripts/pack_staffing_gate_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

windows_file() {
  local f="$WORK/windows.tsv"
  printf '%s\n' "$@" > "$f"
  echo "$f"
}

# ── fixture repo-root: committed seed only, no runtime registry ────────────
SEED_ROOT="$WORK/seed-only-root"
mkdir -p "$SEED_ROOT/swarmforge/model-steward/seed"
cat > "$SEED_ROOT/swarmforge/model-steward/seed/models.seed.json" <<'JSON'
{
  "models": [
    {"provider": "anthropic", "model": "claude-sonnet-5", "status": "certified", "context_window": 200000, "cost_class": "medium", "known_limitations": []}
  ],
  "role_matrix": {
    "QA": [{"provider": "anthropic", "model": "claude-sonnet-5", "score": 0.9, "evidence": "recruiter-scorecard:fixture"}]
  },
  "adapters": {}
}
JSON

# ── 1: seed fallback — no runtime registry.json at all ─────────────────────
WF="$(windows_file "$(printf 'qa1\tQA\tcursor\t--model auto')")"
OUT="$(bb "$CLI" "$SEED_ROOT" "$WF")"
[[ "$OUT" == "qa1"$'\t'"refuse"$'\t'*$'\t'"not-on-role-matrix"$'\t'* ]] \
  || fail "01: seed-fallback registry did not gate cursor/auto against QA (got: $OUT)"

pass "01: falls back to the committed seed when no runtime registry.json exists"

# ── 2: runtime registry takes precedence over the seed ──────────────────────
STATE_DIR="$WORK/state"
mkdir -p "$STATE_DIR/scorecards"
cat > "$STATE_DIR/registry.json" <<'JSON'
{
  "models": {
    "cursor/auto": {"provider": "cursor", "model": "auto", "status": "certified", "certification_report_path": null}
  },
  "capabilities": {},
  "role_matrix": {
    "QA": [{"provider": "cursor", "model": "auto", "score": 0.9, "evidence": "compliance-battery:fixture"}]
  },
  "adapters": {}
}
JSON
cat > "$STATE_DIR/scorecards/cursor__auto.json" <<'JSON'
{"model": "auto", "entries": [{"competency": "QA-gate", "status": "pass", "reason": "fixture"}]}
JSON

WF="$(windows_file "$(printf 'qa1\tQA\tcursor\t--model auto')")"
OUT="$(MODEL_STEWARD_STATE_DIR="$STATE_DIR" bb "$CLI" "$SEED_ROOT" "$WF")"
[[ "$OUT" == "qa1"$'\t'"pass"$'\t'"cursor"$'\t'"auto"$'\t'$'\t' ]] \
  || fail "02: runtime registry+scorecard did not produce a pass decision (got: $OUT)"

pass "02: MODEL_STEWARD_STATE_DIR runtime registry + scorecards/<provider>__<model>.json take precedence over the seed"

# ── 3: no evidence at all — neither runtime registry nor committed seed ────
EMPTY_ROOT="$WORK/empty-root"
mkdir -p "$EMPTY_ROOT"
EMPTY_STATE="$WORK/empty-state"
mkdir -p "$EMPTY_STATE"
WF="$(windows_file "$(printf 'a\tcoder\tclaude\t--model claude-sonnet-5')" "$(printf 'b\tQA\tcursor\t--model auto')")"
OUT="$(MODEL_STEWARD_STATE_DIR="$EMPTY_STATE" bb "$CLI" "$EMPTY_ROOT" "$WF")"
[[ "$OUT" == "NO_EVIDENCE"$'\t'"2" ]] \
  || fail "03: expected NO_EVIDENCE marker with a 2-line window file (got: $OUT)"

pass "03: NO_EVIDENCE marker line when neither a runtime registry nor the committed seed is readable"

# ── 4: role-gate-not-pass — ranked+certified but the scorecard's competency ─
#    for THIS role is not a decided pass (the nemotron shape)
cat > "$STATE_DIR/scorecards/cursor__auto.json" <<'JSON'
{"model": "auto", "entries": [{"competency": "coder-gate", "status": "pass"}, {"competency": "QA-gate", "status": "human-verdict-pending"}]}
JSON
WF="$(windows_file "$(printf 'qa1\tQA\tcursor\t--model auto')")"
OUT="$(MODEL_STEWARD_STATE_DIR="$STATE_DIR" bb "$CLI" "$SEED_ROOT" "$WF")"
[[ "$OUT" == "qa1"$'\t'"refuse"$'\t'"cursor"$'\t'"auto"$'\t'"role-gate-not-pass"$'\t'* ]] \
  || fail "04: a human-verdict-pending QA-gate did not refuse (got: $OUT)"
[[ "$OUT" == *"model_steward_cli.bb"* ]] || fail "04: refusal did not carry a runnable steward command"

pass "04: role-gate-not-pass refuses when the role's own competency is not a decided pass (nemotron shape)"

# ── 5: --override turns a refusal into a staffed override, never a pass ────
cat > "$STATE_DIR/registry.json" <<'JSON'
{
  "models": {"cursor/auto": {"provider": "cursor", "model": "auto", "status": "certified", "certification_report_path": null}},
  "capabilities": {},
  "role_matrix": {},
  "adapters": {}
}
JSON
WF="$(windows_file "$(printf 'qa1\tQA\tcursor\t--model auto')")"
OUT="$(MODEL_STEWARD_STATE_DIR="$STATE_DIR" bb "$CLI" "$SEED_ROOT" "$WF" --override)"
[[ "$OUT" == "qa1"$'\t'"override"$'\t'"cursor"$'\t'"auto"$'\t'"not-on-role-matrix"$'\t'* ]] \
  || fail "05: --override did not produce an 'override' decision distinct from pass (got: $OUT)"

pass "05: --override stages an uncleared seat as 'override', never as a plain 'pass'"

# ── 6: multiple window lines preserve input order in output ────────────────
WF="$(windows_file "$(printf 'z\tcoder\tvibe\t--max-price 2.00')" "$(printf 'a\tQA\tcursor\t--model auto')")"
OUT="$(MODEL_STEWARD_STATE_DIR="$STATE_DIR" bb "$CLI" "$SEED_ROOT" "$WF")"
FIRST_SEAT="$(printf '%s\n' "$OUT" | head -1 | cut -f1)"
[[ "$FIRST_SEAT" == "z" ]] || fail "06: output did not preserve window-line order (got first seat: $FIRST_SEAT)"

pass "06: decisions are emitted one line per window in input order"

# ── 7: the gate reads evidence only — registry.json is byte-identical after ─
BEFORE_SUM="$(sha256sum "$STATE_DIR/registry.json" | cut -d' ' -f1)"
WF="$(windows_file "$(printf 'qa1\tQA\tcursor\t--model auto')")"
bb "$CLI" "$SEED_ROOT" "$WF" --override > /dev/null 2>&1 || true
MODEL_STEWARD_STATE_DIR="$STATE_DIR" bb "$CLI" "$SEED_ROOT" "$WF" > /dev/null
AFTER_SUM="$(sha256sum "$STATE_DIR/registry.json" | cut -d' ' -f1)"
[[ "$BEFORE_SUM" == "$AFTER_SUM" ]] || fail "07: registry.json was mutated by a gate read (invariant 2)"

pass "07: the gate never writes the registry (invariant 2 — reads steward evidence only)"

echo "test_pack_staffing_gate: ALL CHECKS PASSED"
