#!/usr/bin/env bash
# BL-780: rotation-actionability thresholds must sit below flow_watchdog_warn_ms.
# Proves handoffd.bb logs rotation-actionability-ordering-inverted once at
# daemon start when conf inverts the ordering, and stays quiet on sound defaults.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

setup_fixture() {
  local root="$1"
  shift
  git -C "$root" init -q
  git -C "$root" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init

  mkdir -p "$root/.swarmforge" "$root/backlog/active"

  local coder_wt="$root/wt-coder"
  mkdir -p "$coder_wt/.swarmforge/handoffs/inbox/new" "$coder_wt/.swarmforge/handoffs/inbox/in_process"

  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$coder_wt" \
    > "$root/.swarmforge/roles.tsv"

  {
    printf 'config rotation router\nconfig rotation_home coder\n'
    while (($#)); do printf '%s\n' "$1"; shift; done
  } > "$root/swarmforge.conf"

  printf 'active_backlog_max_depth_conf_path\t%s\nrotation\trouter\n' \
    "$root/swarmforge.conf" > "$root/.swarmforge/swarm-identity"

  touch "$root/fake.sock"
  echo "$root/fake.sock" > "$root/.swarmforge/tmux-socket"
}

run_poll_once() {
  local root="$1"
  rm -f "$root/.swarmforge/daemon/handoffd.log"
  SWARMFORGE_ALLOW_TMP_DAEMON=1 bb "$HANDOFFD" "$root" --poll-once >/dev/null
}

log_text() {
  cat "$1/.swarmforge/daemon/handoffd.log"
}

# ── 01: shipped defaults — no ordering warning at daemon start ─────────────
ROOT1="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT1"' EXIT
setup_fixture "$ROOT1"
run_poll_once "$ROOT1"
LOG1="$(log_text "$ROOT1")"
grep -q "rotation-actionability-ordering-inverted" <<< "$LOG1" \
  && fail "01: sound defaults must not log an ordering inversion; log: $LOG1"
pass "01: daemon start with sound defaults logs no rotation-actionability-ordering-inverted"

# ── 02: inverted note_actionable_after_ms — warned once, names both values ─
ROOT2="$(cd "$(mktemp -d)" && pwd -P)"
setup_fixture "$ROOT2" \
  "config rotation_starve_after_ms off" \
  "config note_actionable_after_ms 1200000" \
  "config flow_watchdog_warn_ms 600000"
run_poll_once "$ROOT2"
LOG2="$(log_text "$ROOT2")"
grep -q "rotation-actionability-ordering-inverted" <<< "$LOG2" \
  || fail "02: inverted conf must log rotation-actionability-ordering-inverted; log: $LOG2"
grep -q "note_actionable_after_ms=1200000" <<< "$LOG2" \
  || fail "02: warning must name note_actionable_after_ms; log: $LOG2"
grep -q "flow_watchdog_warn_ms=600000" <<< "$LOG2" \
  || fail "02: warning must name flow_watchdog_warn_ms; log: $LOG2"
COUNT2="$(grep -c "rotation-actionability-ordering-inverted" <<< "$LOG2" || true)"
[[ "$COUNT2" -eq 1 ]] || fail "02: warning must appear exactly once per start; count=$COUNT2"
pass "02: inverted note_actionable_after_ms is reported once at daemon start with both values named"

# ── 03: inverted rotation_starve_after_ms — same contract ──────────────────
ROOT3="$(cd "$(mktemp -d)" && pwd -P)"
setup_fixture "$ROOT3" \
  "config rotation_starve_after_ms 1200000" \
  "config flow_watchdog_warn_ms 900000"
run_poll_once "$ROOT3"
LOG3="$(log_text "$ROOT3")"
grep -q "rotation_starve_after_ms=1200000" <<< "$LOG3" \
  || fail "03: warning must name rotation_starve_after_ms; log: $LOG3"
pass "03: inverted rotation_starve_after_ms is reported at daemon start"

echo "ALL PASS: BL-780 rotation-actionability ordering"
