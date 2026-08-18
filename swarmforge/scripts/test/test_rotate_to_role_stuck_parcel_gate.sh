#!/usr/bin/env bash
# BL-805: rotate_to_role.sh (the resident-invoked rotation entry) must refuse
# to rotate while the DEPARTING role's own inbox/in_process still holds a
# real, unfinished *.handoff parcel - otherwise the parcel ages into the
# babysitter's stuck-in_process WARN and gets falsely resumed the next time
# the resident rotates back into that role. The daemon's own rotation path
# (handoffd.bb chase -> handoff_lib/rotate-resident-to! directly) must never
# be gated the same way, or chase-driven drain could deadlock on the very
# parcel it is trying to clear.
#
# Drives the REAL swarmforge/scripts/*.bb (absolute paths, load-file is not
# cwd-relative) against an isolated fixture git repo so target-root/roles.tsv
# resolution never touches the real swarm state.
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

CODER_WT="$ROOT/wt-coder"
CLEAN_WT="$ROOT/wt-cleaner"
mkdir -p "$CODER_WT/.swarmforge/handoffs/inbox/new" \
         "$CODER_WT/.swarmforge/handoffs/inbox/in_process" \
         "$CLEAN_WT/.swarmforge/handoffs/inbox/new" \
         "$CLEAN_WT/.swarmforge/handoffs/inbox/in_process" \
         "$ROOT/.swarmforge/launch"

printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" > "$ROOT/.swarmforge/roles.tsv"
printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$CLEAN_WT" >> "$ROOT/.swarmforge/roles.tsv"

# BL-931: this fixture's own concern is the stuck-parcel gate, not the
# pack-router gate test_rotate_pack_router_gate.sh covers - declare a
# rotation-router pack here so every scenario below still exercises what it
# always did, rather than being refused upstream by the new gate before it
# ever reaches the stuck-parcel check.
mkdir -p "$ROOT/swarmforge"
printf 'config rotation router\n' > "$ROOT/swarmforge/swarmforge.conf"

touch "$ROOT/fake.sock"
echo "$ROOT/fake.sock" > "$ROOT/.swarmforge/tmux-socket"

printf '#!/bin/sh\nexit 0\n' > "$ROOT/.swarmforge/launch/cleaner.sh"
chmod +x "$ROOT/.swarmforge/launch/cleaner.sh"
# BL-926 scenario 09 rotates coder -> coder (same-role, into the parcel's
# own owner), so coder needs its own launch script too.
printf '#!/bin/sh\nexit 0\n' > "$ROOT/.swarmforge/launch/coder.sh"
chmod +x "$ROOT/.swarmforge/launch/coder.sh"

FAKE_BIN="$ROOT/bin"
make_fake_tmux "$FAKE_BIN"
TMUX_LOG="$ROOT/tmux-calls.log"
export TMUX_LOG
touch "$TMUX_LOG"

# cleaner's inbox/new already holds the just-forwarded parcel (the realistic
# case: coder git_handoff'd to cleaner, THEN rotates) so wait-for-delivery!
# inside rotate-resident-to! returns immediately instead of polling 30s.
printf 'id: fwd\nfrom: coder\nto: cleaner\npriority: 50\ntype: git_handoff\ntask: BL-000\ncommit: aaaaaaaaaa\n\nmerge_and_process coder aaaaaaaaaa\n' \
  > "$CLEAN_WT/.swarmforge/handoffs/inbox/new/00_fwd.handoff"

queue_stuck_parcel() {
  local name="$1"
  printf 'id: %s\nfrom: coordinator\nto: coder\npriority: 50\ntype: git_handoff\ntask: BL-%s\ncommit: aaaaaaaaaa\n\nmerge_and_process coordinator aaaaaaaaaa\n' \
    "$name" "$name" > "$CODER_WT/.swarmforge/handoffs/inbox/in_process/00_${name}.handoff"
}

run_rotate() {
  (cd "$CODER_WT" && PATH="$FAKE_BIN:$PATH" bash "$ROTATE_SH" "$1")
}

# coder is the departing/active role for every resident-invoked scenario.
echo "coder" > "$ROOT/.swarmforge/mono-router-active-role"

# ── 01: refused while the departing role's in_process holds a real parcel ──
queue_stuck_parcel stuck1
: > "$TMUX_LOG"
set +e
OUT="$(run_rotate cleaner 2>&1)"
STATUS=$?
set -e
[[ "$STATUS" -ne 0 ]] || fail "01: expected nonzero exit, got 0 (output: $OUT)"
echo "$OUT" | grep -qi "done_with_current.sh" || fail "01: refusal must name done_with_current.sh, got: $OUT"
grep -q "respawn-pane" "$TMUX_LOG" && fail "01: pane must NOT be respawned on refusal, log: $(cat "$TMUX_LOG")"
grep -q "^coder$" "$ROOT/.swarmforge/mono-router-active-role" \
  || fail "01: active-role marker must be untouched by a refused rotation"
pass "01: rotation is refused while the departing role holds an unfinished parcel"

# ── 02: proceeds once in_process is drained ─────────────────────────────────
rm -f "$CODER_WT/.swarmforge/handoffs/inbox/in_process"/*.handoff
: > "$TMUX_LOG"
OUT="$(run_rotate cleaner 2>&1)"
grep -q "respawn-pane" "$TMUX_LOG" || fail "02: expected a respawn-pane call, log: $(cat "$TMUX_LOG")"
grep -q "^cleaner$" "$ROOT/.swarmforge/mono-router-active-role" || fail "02: active-role marker not updated to cleaner"
pass "02: rotation proceeds when the departing role's in_process box is empty"
echo "coder" > "$ROOT/.swarmforge/mono-router-active-role"

# ── 03: sidecar droppings alone never block rotation ────────────────────────
echo '{}' > "$CODER_WT/.swarmforge/handoffs/inbox/in_process/orphan.claim-progress.json"
: > "$TMUX_LOG"
OUT="$(run_rotate cleaner 2>&1)"
grep -q "respawn-pane" "$TMUX_LOG" || fail "03: sidecar-only in_process wrongly blocked rotation, log: $(cat "$TMUX_LOG")"
pass "03: sidecar droppings alone never block rotation"
rm -f "$CODER_WT/.swarmforge/handoffs/inbox/in_process"/*.claim-progress.json
echo "coder" > "$ROOT/.swarmforge/mono-router-active-role"

# ── 04: daemon-initiated rotation is never gated on a stuck parcel ─────────
# Drives handoff-lib/rotate-resident-to! directly - the exact function
# handoffd.bb's chase sweep calls, bypassing rotate_to_role.sh/respawn-as!
# entirely, same as production.
queue_stuck_parcel stuck4
: > "$TMUX_LOG"
OUT="$(cd "$CODER_WT" && PATH="$FAKE_BIN:$PATH" bb -e "
(load-file \"$HANDOFF_LIB\")
(println (handoff-lib/rotate-resident-to! \"cleaner\"))
")"
echo "$OUT" | grep -q ":ok true" || fail "04: expected rotate-resident-to! to succeed despite a stuck parcel, got: $OUT"
grep -q "respawn-pane" "$TMUX_LOG" || fail "04: daemon-path rotate must still respawn despite a stuck parcel, log: $(cat "$TMUX_LOG")"
pass "04: daemon-initiated rotation is never gated on a stuck parcel"
rm -f "$CODER_WT/.swarmforge/handoffs/inbox/in_process"/*.handoff
echo "coder" > "$ROOT/.swarmforge/mono-router-active-role"

# ── 05: an explicit force override rotates anyway with a loud warning ──────
queue_stuck_parcel stuck5
: > "$TMUX_LOG"
OUT="$(cd "$CODER_WT" && PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROTATE_FORCE=1 bash "$ROTATE_SH" cleaner 2>&1)"
grep -q "respawn-pane" "$TMUX_LOG" || fail "05: force override must still rotate, log: $(cat "$TMUX_LOG")"
echo "$OUT" | grep -qi "WARNING" || fail "05: force override must warn loudly, got: $OUT"
echo "$OUT" | grep -q "stuck5" || fail "05: warning must name the stuck parcel left behind, got: $OUT"
pass "05: an explicit force override rotates anyway with a loud warning naming the stuck parcel"

# ── 06/07/08: fail-open when the departing role cannot be determined ───────
# The ticket's CONSTRAINTS require rotation to proceed (never strand the
# resident) whenever departing-role-blocking-handoff cannot resolve a real
# departing role - missing marker, blank marker, or a marker naming a role
# absent from roles.tsv. Each case below leaves a REAL stuck parcel sitting
# in coder's in_process (the same fixture 01 refuses on) so a pass here only
# happens via the fail-open guard clauses, never because nothing was there
# to block on.
rm -f "$CODER_WT/.swarmforge/handoffs/inbox/in_process"/*.handoff
echo "coder" > "$ROOT/.swarmforge/mono-router-active-role"

queue_stuck_parcel stuck6
rm -f "$ROOT/.swarmforge/mono-router-active-role"
: > "$TMUX_LOG"
OUT="$(run_rotate cleaner 2>&1)"
grep -q "respawn-pane" "$TMUX_LOG" || fail "06: missing active-role marker wrongly blocked rotation, log: $(cat "$TMUX_LOG")"
pass "06: fail-open when the active-role marker file is missing"
rm -f "$CODER_WT/.swarmforge/handoffs/inbox/in_process"/*.handoff
echo "coder" > "$ROOT/.swarmforge/mono-router-active-role"

queue_stuck_parcel stuck7
printf '   \n' > "$ROOT/.swarmforge/mono-router-active-role"
: > "$TMUX_LOG"
OUT="$(run_rotate cleaner 2>&1)"
grep -q "respawn-pane" "$TMUX_LOG" || fail "07: blank active-role marker wrongly blocked rotation, log: $(cat "$TMUX_LOG")"
pass "07: fail-open when the active-role marker is blank"
rm -f "$CODER_WT/.swarmforge/handoffs/inbox/in_process"/*.handoff
echo "coder" > "$ROOT/.swarmforge/mono-router-active-role"

queue_stuck_parcel stuck8
echo "nonexistent-role" > "$ROOT/.swarmforge/mono-router-active-role"
: > "$TMUX_LOG"
OUT="$(run_rotate cleaner 2>&1)"
grep -q "respawn-pane" "$TMUX_LOG" || fail "08: unknown-role active-role marker wrongly blocked rotation, log: $(cat "$TMUX_LOG")"
pass "08: fail-open when the active-role marker names a role absent from roles.tsv"
rm -f "$CODER_WT/.swarmforge/handoffs/inbox/in_process"/*.handoff
echo "coder" > "$ROOT/.swarmforge/mono-router-active-role"

# ── 09: rotating INTO the role that owns the blocking parcel proceeds ──────
# BL-926: the departing role (active-role marker) and the rotation target
# are the SAME role here - rotating there is not abandonment, it is the only
# way the stuck parcel gets picked up. The gate must proceed, and the parcel
# itself must survive byte-identical (rotation never removes, moves, renames
# or completes it - it is resumed via ready_for_next.sh's in_process-first
# check, not re-delivered).
queue_stuck_parcel stuck9
PARCEL_PATH="$CODER_WT/.swarmforge/handoffs/inbox/in_process/00_stuck9.handoff"
BEFORE_SHA="$(shasum "$PARCEL_PATH" | awk '{print $1}')"
: > "$TMUX_LOG"
OUT="$(run_rotate coder 2>&1)"
grep -q "respawn-pane" "$TMUX_LOG" \
  || fail "09: rotating into the parcel's own owner must respawn, log: $(cat "$TMUX_LOG")"
[[ -f "$PARCEL_PATH" ]] || fail "09: parcel must survive a same-role rotation, missing: $PARCEL_PATH"
AFTER_SHA="$(shasum "$PARCEL_PATH" | awk '{print $1}')"
[[ "$BEFORE_SHA" == "$AFTER_SHA" ]] \
  || fail "09: parcel content must be byte-identical after a same-role rotation"
grep -q "^coder$" "$ROOT/.swarmforge/mono-router-active-role" \
  || fail "09: active-role marker must (re)name coder after rotating into coder"
# ready_for_next_task.bb's in_process-first check (BL-529) resumes rather
# than reporting NO_TASK precisely when exactly one real *.handoff file sits
# in in_process/ - the rotation must neither drain it (zero files) nor
# duplicate it (more than one).
IN_PROCESS_COUNT="$(find "$CODER_WT/.swarmforge/handoffs/inbox/in_process" -name '*.handoff' -type f | wc -l | tr -d ' ')"
[[ "$IN_PROCESS_COUNT" == "1" ]] \
  || fail "09: expected exactly one in_process parcel after rotation (resume precondition), found $IN_PROCESS_COUNT"
pass "09: rotation into the parcel's own owner proceeds and leaves the parcel untouched"
rm -f "$CODER_WT/.swarmforge/handoffs/inbox/in_process"/*.handoff
echo "coder" > "$ROOT/.swarmforge/mono-router-active-role"

echo "test_rotate_to_role_stuck_parcel_gate: ALL CHECKS PASSED"
