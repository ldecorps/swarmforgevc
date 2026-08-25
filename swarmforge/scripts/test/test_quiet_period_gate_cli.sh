#!/usr/bin/env bash
# BL-327: quiet_period_gate_cli.bb - the shell-callable entry point for
# BL-318's promotion-blocked-by-quiet-period?/format-self-generated-source
# (operator_lib.bb), so the coordinator's sole enforcement path for a HIGH
# cost-control gate is a real command with a defined exit-code contract,
# never prompt prose hand-assembling a bare Clojure call.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../quiet_period_gate_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

printf 'id: BL-500\nstatus: todo\nsource: "Raised by the coordinator itself (self-generated) - cost review flagged idle quota"\n' \
  > "$ROOT/self-generated.yaml"
printf 'id: BL-501\nstatus: todo\nsource: "Raised by the human 2026-07-13 via INTAKE-foo.md"\n' \
  > "$ROOT/human.yaml"
printf 'id: BL-502\nstatus: todo\nsource: "coordinator wrote this by hand (self-generated) - no tool used"\n' \
  > "$ROOT/hand-written.yaml"
printf 'id: BL-503\nstatus: todo\n' > "$ROOT/no-source.yaml"

# ── quiet-period-gate-cli-01: blocks only self-generated work in a quiet period
set +e
OUT="$(bb "$CLI" blocked "$ROOT/self-generated.yaml" --backlog-drained true --roster-idle true)"; CODE=$?
set -e
[[ "$OUT" == "blocked" && "$CODE" -eq 1 ]] || fail "coordinator-raised + quiet: expected blocked/1, got $OUT/$CODE"
pass "coordinator-raised + drained&idle -> blocked, exit 1"

set +e
OUT="$(bb "$CLI" blocked "$ROOT/self-generated.yaml" --backlog-drained true --roster-idle false)"; CODE=$?
set -e
[[ "$OUT" == "allowed" && "$CODE" -eq 0 ]] || fail "coordinator-raised + roster busy: expected allowed/0, got $OUT/$CODE"
pass "coordinator-raised + roster busy -> allowed, exit 0"

set +e
OUT="$(bb "$CLI" blocked "$ROOT/self-generated.yaml" --backlog-drained false --roster-idle true)"; CODE=$?
set -e
[[ "$OUT" == "allowed" && "$CODE" -eq 0 ]] || fail "coordinator-raised + active backlog: expected allowed/0, got $OUT/$CODE"
pass "coordinator-raised + active backlog -> allowed, exit 0"

set +e
OUT="$(bb "$CLI" blocked "$ROOT/human.yaml" --backlog-drained true --roster-idle true)"; CODE=$?
set -e
[[ "$OUT" == "allowed" && "$CODE" -eq 0 ]] || fail "human-raised + quiet: expected allowed/0, got $OUT/$CODE"
pass "human-raised + drained&idle -> allowed, exit 0 (the gate never starves real work)"

set +e
OUT="$(bb "$CLI" blocked "$ROOT/human.yaml" --backlog-drained false --roster-idle false)"; CODE=$?
set -e
[[ "$OUT" == "allowed" && "$CODE" -eq 0 ]] || fail "human-raised + busy: expected allowed/0, got $OUT/$CODE"
pass "human-raised + active&busy -> allowed, exit 0"

# ── quiet-period-gate-cli-02: a tool-composed source round-trips through the gate
COMPOSED="$(bb "$CLI" compose-source "cost review flagged idle quota")"
[[ "$COMPOSED" == *"(self-generated)"* ]] || fail "compose-source did not carry the marker: $COMPOSED"
printf 'id: BL-504\nstatus: todo\nsource: "%s"\n' "$COMPOSED" > "$ROOT/composed.yaml"
set +e
OUT="$(bb "$CLI" blocked "$ROOT/composed.yaml" --backlog-drained true --roster-idle true)"; CODE=$?
set -e
[[ "$OUT" == "blocked" && "$CODE" -eq 1 ]] || fail "tool-composed source: expected blocked/1, got $OUT/$CODE"
pass "a tool-composed source line round-trips: recognized self-generated, blocked during a quiet period"

# ── quiet-period-gate-cli-03: a hand-written (but marker-bearing) source does not escape
set +e
OUT="$(bb "$CLI" blocked "$ROOT/hand-written.yaml" --backlog-drained true --roster-idle true)"; CODE=$?
set -e
[[ "$OUT" != "allowed" ]] || fail "hand-written marker-bearing source silently escaped the gate: $OUT/$CODE"
[[ "$OUT" == "blocked" && "$CODE" -eq 1 ]] || fail "expected hand-written marker-bearing source blocked/1, got $OUT/$CODE"
pass "a hand-written source line carrying the marker still does not escape the gate"

# ── quiet-period-gate-cli-04: an unreadable/invalid candidate fails closed
set +e
OUT="$(bb "$CLI" blocked "$ROOT/does-not-exist.yaml" --backlog-drained true --roster-idle true)"; CODE=$?
set -e
[[ "$OUT" == "error" && "$CODE" -eq 2 ]] || fail "unreadable candidate: expected error/2, got $OUT/$CODE"
[[ "$OUT" != "allowed" ]] || fail "an unreadable candidate must never answer allowed"
pass "an unreadable candidate fails closed: error, exit 2, never allowed"

set +e
OUT="$(bb "$CLI" blocked "$ROOT/human.yaml" --backlog-drained true)"; CODE=$?
set -e
[[ "$OUT" == "error" && "$CODE" -eq 2 ]] || fail "missing quiet-state flag: expected error/2, got $OUT/$CODE"
pass "a missing quiet-state input fails closed: error, exit 2, never allowed"

# ── quiet-period-gate-cli-05: reachable as a plain shell command ─────────
OUT="$(bb "$CLI" blocked "$ROOT/no-source.yaml" --backlog-drained true --roster-idle true)"
[[ "$OUT" == "allowed" ]] || fail "no-source candidate should be treated as not-self-generated (conservative default): $OUT"
pass "a candidate with no source field at all is treated as not-self-generated -> allowed"

echo "ALL PASS"
