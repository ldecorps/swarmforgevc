#!/usr/bin/env bash
# BL-1641: compose_banked_briefing_cli.bb - the standalone CLI a non-bb
# caller (the closing ceremony's Node.js executor) uses to compose and
# write the banked headless briefing against an explicit root.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../compose_banked_briefing_cli.bb"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1641-compose-cli"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1641_COMPOSE_CLI_BOUND_SECONDS:-120}" "$@"
trap 'rm -rf "$WORK"' EXIT

make_root() {  # make_root <name>
  root="$WORK/$1"
  mkdir -p "$root/backlog/active" "$root/backlog/paused" "$root/backlog/done" \
           "$root/docs/briefings" "$root/.swarmforge/operator"
  git init -q "$root" >/dev/null 2>&1
}

# ── 01: no --label keeps BL-308's own hibernated label unchanged ─────────
make_root sc01
out01="$(bb "$CLI" "$root" 2026-09-21 2>&1)"
first_line01="$(head -1 "$root/docs/briefings/2026-09-21.md" 2>/dev/null)"
if [[ "$first_line01" == "Swarm parked - lightweight briefing for 2026-09-21" ]]; then
  pass "omitting --label keeps the hibernated label unchanged"
else
  fail "expected the default hibernated label, got: $first_line01 ($out01)"
fi

# ── 02: an explicit --label replaces the subject line ────────────────────
make_root sc02
bb "$CLI" "$root" 2026-09-21 --label "Closing ceremony - headless briefing" >/dev/null 2>&1
first_line02="$(head -1 "$root/docs/briefings/2026-09-21.md" 2>/dev/null)"
if [[ "$first_line02" == "Closing ceremony - headless briefing for 2026-09-21" ]]; then
  pass "an explicit --label replaces the subject line"
else
  fail "expected the closing-ceremony label, got: $first_line02"
fi

# ── 03: backlog counts reflect the real fixture, not zeros by luck ───────
make_root sc03
touch "$root/backlog/active/BL-1.yaml" "$root/backlog/active/BL-2.yaml" "$root/backlog/paused/BL-3.yaml"
bb "$CLI" "$root" 2026-09-21 >/dev/null 2>&1
content03="$(cat "$root/docs/briefings/2026-09-21.md" 2>/dev/null)"
if grep -q "active: 2" <<<"$content03" && grep -q "paused: 1" <<<"$content03" && grep -q "done: 0" <<<"$content03"; then
  pass "backlog counts reflect the fixture's real active/paused/done yaml files"
else
  fail "expected active: 2 / paused: 1 / done: 0, got: $content03"
fi

# ── 04: missing required args refuses with a usage message ──────────────
out04="$(bb "$CLI" 2>&1)"; rc04=$?
if [[ "$rc04" -ne 0 ]] && grep -qi "usage" <<<"$out04"; then
  pass "missing arguments refuses with a usage message, never a stack trace"
else
  fail "expected a non-zero usage refusal, got rc=$rc04: $out04"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
