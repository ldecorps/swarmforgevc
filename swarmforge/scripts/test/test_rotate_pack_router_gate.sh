#!/usr/bin/env bash
# BL-931: the resident-invoked rotate (rotate_to_role.sh -> respawn-as! ->
# rotate-resident-to!) and the daemon's own chase-driven rotate-resident-to!
# call must both refuse on a pack that is not a rotation router - a standing
# pack (full-forge: every pipeline role has its own pane) has no resident to
# rotate, so mono-router-resident-session's "first non-coordinator roles.tsv
# row" would otherwise address and evict a working colleague's pane (the
# standing specifier, twice, on 2026-08-18).
#
# Drives the REAL swarmforge/scripts/*.bb (absolute paths, load-file is not
# cwd-relative) against an isolated fixture git repo, same pattern as
# test_rotate_to_role_stuck_parcel_gate.sh (BL-805) and
# test_rotate_recomposes_role_prompt.sh (BL-911).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROTATE_SH="$REAL_SCRIPTS_DIR/rotate_to_role.sh"
HANDOFF_LIB="$REAL_SCRIPTS_DIR/handoff_lib.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

make_fake_tmux() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$TMUX_LOG"
exit 0
TMUX
  chmod +x "$bin_dir/tmux"
}

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

# ── a standing full-forge-shaped pack: specifier is roles.tsv row 1 (the
#    exact shape rotate-resident-to! would otherwise address as "resident") ─
SPEC_WT="$ROOT/wt-specifier"
CODER_WT="$ROOT/wt-coder"
mkdir -p "$SPEC_WT/.swarmforge/handoffs/inbox/new" \
         "$SPEC_WT/.swarmforge/handoffs/inbox/in_process" \
         "$CODER_WT/.swarmforge/handoffs/inbox/new" \
         "$CODER_WT/.swarmforge/handoffs/inbox/in_process" \
         "$ROOT/.swarmforge/launch"

printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$SPEC_WT" > "$ROOT/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" >> "$ROOT/.swarmforge/roles.tsv"

touch "$ROOT/fake.sock"
echo "$ROOT/fake.sock" > "$ROOT/.swarmforge/tmux-socket"

printf '#!/bin/sh\nexit 0\n' > "$ROOT/.swarmforge/launch/coder.sh"
chmod +x "$ROOT/.swarmforge/launch/coder.sh"

FAKE_BIN="$ROOT/bin"
make_fake_tmux "$FAKE_BIN"
TMUX_LOG="$ROOT/tmux-calls.log"
export TMUX_LOG
touch "$TMUX_LOG"

# coder's inbox/new already holds a parcel so wait-for-delivery! inside
# rotate-resident-to! returns immediately instead of polling 30s.
printf 'id: fwd\nfrom: specifier\nto: coder\npriority: 50\ntype: git_handoff\ntask: BL-000\ncommit: aaaaaaaaaa\n\nmerge_and_process specifier aaaaaaaaaa\n' \
  > "$CODER_WT/.swarmforge/handoffs/inbox/new/00_fwd.handoff"

# The exact 2026-08-18 incident shape: the resident-invoked rotate is
# called AS the standing specifier pane, targeting coder.
echo "specifier" > "$ROOT/.swarmforge/mono-router-active-role"
MARKER_FILE="$ROOT/.swarmforge/mono-router-active-role"

run_rotate() {
  (cd "$SPEC_WT" && PATH="$FAKE_BIN:$PATH" bash "$ROTATE_SH" "$1")
}

run_rotate_via_daemon_path() {
  (cd "$SPEC_WT" && PATH="$FAKE_BIN:$PATH" bb -e "
(load-file \"$HANDOFF_LIB\")
(println (handoff-lib/rotate-resident-to! \"coder\"))
")
}

write_conf() {
  mkdir -p "$ROOT/swarmforge"
  printf '%s' "$1" > "$ROOT/swarmforge/swarmforge.conf"
}

remove_conf() {
  rm -f "$ROOT/swarmforge/swarmforge.conf"
}

# ── 01: refused on a standing pack (no conf at all - the intake's exact
#        shape), naming the pack, marker and tmux both untouched ──────────
remove_conf
MARKER_BEFORE="$(cat "$MARKER_FILE")"
: > "$TMUX_LOG"
set +e
OUT="$(run_rotate coder 2>&1)"
STATUS=$?
set -e
[[ "$STATUS" -ne 0 ]] || fail "01: expected nonzero exit, got 0 (output: $OUT)"
echo "$OUT" | grep -qi "does not rotate" || fail "01: refusal must name the pack, not the misleading old text, got: $OUT"
echo "$OUT" | grep -qvi "is this swarm a mono-router" || fail "01: must not fall through to the old misleading no-launch-script text"
[[ -z "$(cat "$TMUX_LOG")" ]] || fail "01: no tmux command may run on refusal, log: $(cat "$TMUX_LOG")"
[[ "$(cat "$MARKER_FILE")" == "$MARKER_BEFORE" ]] \
  || fail "01: active-role marker must be byte-identical to before the refused run"
pass "01: rotation is refused on a standing pack, naming the pack, with no tmux call and the marker untouched"

# ── 02: router pack (declared via conf) still rotates exactly as before ───
write_conf "config rotation router
"
: > "$TMUX_LOG"
OUT="$(run_rotate coder 2>&1)"
grep -q "respawn-pane" "$TMUX_LOG" || fail "02: expected a respawn-pane call on a router pack, log: $(cat "$TMUX_LOG")"
grep -q "^coder$" "$MARKER_FILE" || fail "02: active-role marker not updated to coder"
pass "02: a router pack (declared via conf) still rotates exactly as before"
echo "specifier" > "$MARKER_FILE"

# ── 02b: router pack declared via swarm-identity's rotation key instead of
#         the conf - invariant 1's second resolution branch. A conf-only
#         check would silently break this. ─────────────────────────────────
remove_conf
printf 'launch_pack\tmono-router\nrotation\trouter\n' > "$ROOT/.swarmforge/swarm-identity"
: > "$TMUX_LOG"
OUT="$(run_rotate coder 2>&1)"
grep -q "respawn-pane" "$TMUX_LOG" || fail "02b: expected a respawn-pane call when swarm-identity records rotation=router, log: $(cat "$TMUX_LOG")"
pass "02b: a router pack recorded in swarm-identity (no conf line) still rotates"
echo "specifier" > "$MARKER_FILE"
rm -f "$ROOT/.swarmforge/swarm-identity"

# ── 03: the daemon caller (handoff-lib/rotate-resident-to! directly) gets ──
#        a result map naming the pack, never an exception, never exiting ──
remove_conf
: > "$TMUX_LOG"
OUT="$(run_rotate_via_daemon_path)"
echo "$OUT" | grep -q ':ok false' || fail "03: expected a refused result map, got: $OUT"
echo "$OUT" | grep -q 'not-a-rotation-router' || fail "03: expected the pack reason, got: $OUT"
[[ -z "$(cat "$TMUX_LOG")" ]] || fail "03: no tmux command may run, log: $(cat "$TMUX_LOG")"
pass "03: the daemon-path caller gets a refusal result map naming the pack, never an exception or exit"

# ── 04: SWARMFORGE_ROTATE_FORCE=1 does not unlock the pack gate - it is ───
#        BL-805's departing-role override, a different concern ────────────
remove_conf
: > "$TMUX_LOG"
set +e
OUT="$(cd "$SPEC_WT" && PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROTATE_FORCE=1 bash "$ROTATE_SH" coder 2>&1)"
STATUS=$?
set -e
[[ "$STATUS" -ne 0 ]] || fail "04: expected the force override to still refuse, got exit 0 (output: $OUT)"
echo "$OUT" | grep -qi "does not rotate" || fail "04: force override must still refuse for the pack reason, got: $OUT"
[[ -z "$(cat "$TMUX_LOG")" ]] || fail "04: no tmux command may run even with the force override set, log: $(cat "$TMUX_LOG")"
pass "04: SWARMFORGE_ROTATE_FORCE=1 does not unlock the pack gate"

# ── 05: mono-router-resident-session's own "first non-coordinator row" ────
#        definition is untouched by this fix - on a legitimate router-pack
#        rotation, the SESSION respawned is still swarmforge-specifier
#        (roles.tsv row 1), now running coder's launch script. The fix
#        refuses the rotation on a standing pack; it does not change which
#        pane a legitimate rotation addresses. ─────────────────────────────
write_conf "config rotation router
"
: > "$TMUX_LOG"
OUT="$(run_rotate coder 2>&1)"
grep -q "swarmforge-specifier" "$TMUX_LOG" \
  || fail "05: expected the respawn to target swarmforge-specifier (roles.tsv's first non-coordinator row, unchanged), log: $(cat "$TMUX_LOG")"
pass "05: mono-router-resident-session's own row selection is unchanged - the fix refuses, it does not re-address"

echo "test_rotate_pack_router_gate: ALL CHECKS PASSED"
