#!/usr/bin/env bash
# BL-216: swarm_handoff.bb's depth WARNING and ready_for_next.bb's
# AUTO-PROMOTE gate both used to read a nonexistent conf path and mis-parse
# the -1 no-limit sentinel as 1. Covers acceptance scenarios BL-216
# depth-01..04 end-to-end against the real scripts (never the live swarm's
# own project root/backlog).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"
READY_FOR_NEXT="$SCRIPT_DIR/../ready_for_next.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_fixture() {
  local cap="$1"
  local root
  root="$(cd "$(mktemp -d)" && pwd -P)"
  git -C "$root" init -q
  git -C "$root" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init
  mkdir -p "$root/.swarmforge" "$root/swarmforge" "$root/backlog/active" "$root/backlog/paused"
  printf "coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n" "$root" > "$root/.swarmforge/roles.tsv"
  printf 'config active_backlog_max_depth %s\n' "$cap" > "$root/swarmforge/swarmforge.conf"
  echo "$root"
}

write_active_items() {
  local root="$1" n="$2"
  for i in $(seq 1 "$n"); do
    printf 'id: BL-%s\ntitle: "demo"\nstatus: active\n' "$i" > "$root/backlog/active/BL-$i-demo.yaml"
  done
}

write_draft() {
  local root="$1"
  printf 'type: awake\nto: coordinator\npriority: 50\n' > "$root/draft.txt"
}

# ── depth-01: the depth warning fires only for a positive cap the active
#     count exceeds ───────────────────────────────────────────────────────
run_handoff_capture_stderr() {
  local root="$1"
  write_draft "$root"
  (cd "$root" && SWARMFORGE_ROLE=coordinator SWARMFORGE_SKIP_DAEMON=1 SWARMFORGE_MAILBOX_ONLY=1 \
    bb "$SWARM_HANDOFF" "$root/draft.txt" 2>&1 1>/dev/null || true)
}

ROOT="$(mk_fixture -1)"
write_active_items "$ROOT" 5
OUT="$(run_handoff_capture_stderr "$ROOT")"
echo "$OUT" | grep -qi "Active backlog depth exceeded" \
  && fail "depth-01a: no-limit (-1) with active=5 must not warn; got: $OUT"
pass "depth-01a: cap=-1, active=5 -> no warning"
rm -rf "$ROOT"

ROOT="$(mk_fixture 3)"
write_active_items "$ROOT" 5
OUT="$(run_handoff_capture_stderr "$ROOT")"
echo "$OUT" | grep -qi "Active backlog depth exceeded (active=5, max=3)" \
  || fail "depth-01b: cap=3, active=5 must warn with the real numbers; got: $OUT"
pass "depth-01b: cap=3, active=5 -> warning with the real (not silently defaulted) numbers"
rm -rf "$ROOT"

ROOT="$(mk_fixture 3)"
write_active_items "$ROOT" 2
OUT="$(run_handoff_capture_stderr "$ROOT")"
echo "$OUT" | grep -qi "Active backlog depth exceeded" \
  && fail "depth-01c: cap=3, active=2 must not warn; got: $OUT"
pass "depth-01c: cap=3, active=2 -> no warning"
rm -rf "$ROOT"

# ── depth-02: removed ─────────────────────────────────────────────────────
# This used to pin that ready_for_next.bb's (dead, unreachable) paused-item
# auto-promotion helper read the depth cap via the shared backlog-depth-lib
# functions. BL-226 deleted that helper entirely (it never belonged in a
# receive helper - promotion is the coordinator's exclusive duty, and the
# code was provably unreachable besides), so there is nothing left here to
# pin; backlog_depth_test_runner.bb still covers backlog-depth-lib's own
# read-max-depth/under-depth-cap? logic directly.

# ── depth-03: the cap comes from the tracked config, not a silent default ─
ROOT="$(mk_fixture 3)"
[[ ! -e "$ROOT/.swarmforge/swarmforge.conf" ]] \
  || fail "depth-03 setup: fixture must not have a .swarmforge/swarmforge.conf"
write_active_items "$ROOT" 4
OUT="$(run_handoff_capture_stderr "$ROOT")"
echo "$OUT" | grep -qi "max=3" \
  || fail "depth-03: expected the real tracked cap (3), not the silent default (5); got: $OUT"
pass "depth-03: the cap comes from the real tracked swarmforge/swarmforge.conf, not a silent default"
rm -rf "$ROOT"

# ── depth-04: an absent config degrades gracefully (no crash, no spurious
#     over-cap warning) ───────────────────────────────────────────────────
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init
mkdir -p "$ROOT/.swarmforge" "$ROOT/backlog/active"
printf "coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n" "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
# Deliberately no swarmforge/swarmforge.conf at all.
write_active_items "$ROOT" 3
set +e
OUT="$(run_handoff_capture_stderr "$ROOT")"
STATUS=$?
set -e
[[ "$STATUS" -eq 0 ]] || fail "depth-04: expected no crash with an absent config; got exit $STATUS: $OUT"
echo "$OUT" | grep -qi "Active backlog depth exceeded" \
  && fail "depth-04: an absent config must not produce a spurious over-cap warning (active=3 is under the default cap of 5); got: $OUT"
pass "depth-04: an absent config degrades gracefully - no crash, no spurious warning"
rm -rf "$ROOT"

# ── BL-313: the real WARNING enforces a PERSISTED pack override, not the
#     default swarmforge/swarmforge.conf's own cap ────────────────────────
# depth-cap-override-01: the default file declares -1 (no limit), but a
# pack override persisted into .swarmforge/swarm-identity at launch time
# (BL-313's own write_swarm_identity_file) declares 1 - the WARNING must
# enforce the PACK's 1, not the default's -1.
ROOT="$(mk_fixture -1)"
mkdir -p "$ROOT/elsewhere"
printf 'config active_backlog_max_depth 1\n' > "$ROOT/elsewhere/pack.conf"
printf 'swarm_name\tprimary\nswarm_mode\tautonomous\nactive_backlog_max_depth\t1\nactive_backlog_max_depth_conf_path\t%s\n' \
  "$ROOT/elsewhere/pack.conf" > "$ROOT/.swarmforge/swarm-identity"
write_active_items "$ROOT" 2
OUT="$(run_handoff_capture_stderr "$ROOT")"
echo "$OUT" | grep -qi "Active backlog depth exceeded (active=2, max=1)" \
  || fail "depth-cap-override-01: expected the persisted pack's cap (1) enforced, not the default file's -1; got: $OUT"
pass "depth-cap-override-01: a persisted pack override (max=1) is enforced over the default file's own -1"
rm -rf "$ROOT"

# ── depth-cap-override-02: no persisted override at all (no swarm-identity
#     file) -> the default tracked config's own cap is still enforced,
#     unchanged from depth-03 above ────────────────────────────────────────
ROOT="$(mk_fixture 3)"
[[ ! -e "$ROOT/.swarmforge/swarm-identity" ]] \
  || fail "depth-cap-override-02 setup: fixture must not have a swarm-identity file"
write_active_items "$ROOT" 5
OUT="$(run_handoff_capture_stderr "$ROOT")"
echo "$OUT" | grep -qi "max=3" \
  || fail "depth-cap-override-02: expected the default file's own cap (3) with no persisted override; got: $OUT"
pass "depth-cap-override-02: no persisted override -> the default tracked config's cap is still enforced"
rm -rf "$ROOT"

echo "ALL PASS"
