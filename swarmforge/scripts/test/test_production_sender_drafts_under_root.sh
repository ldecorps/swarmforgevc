#!/usr/bin/env bash
# BL-1537: every shell sender of swarm_handoff.sh must build its draft under
# the fixture root's own tmp/ directory, never under TMPDIR/os.tmpdir() -
# BL-1518-a's fail-closed guard in swarm_handoff.bb refuses any draft that is
# not under the project root the CLI resolved. This drives the four REAL
# shell senders (promote_and_route_next.sh, route_backlog_to_coder.sh,
# mailbox_note_to_role.sh, inject_note_to_role.sh) against a real git fixture
# with TMPDIR pointed at a SIBLING directory outside that fixture - the same
# real-CLI-real-fixture discipline as test_bl1097_router_refuses_dispatched_ticket.sh.
# The three TypeScript senders (closing-ceremony-run.ts,
# night-closing-ceremony-run.ts, tracer-bullet-launcher.ts) are covered by
# specs/pipeline/steps/bl1537ProductionSenderDraftsUnderRootSteps.js instead,
# which drives their compiled extension/out/tools/ entries against the same
# shape of fixture.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMOTE_SH="$SCRIPTS/promote_and_route_next.sh"
ROUTE_SH="$SCRIPTS/route_backlog_to_coder.sh"
MAILBOX_SH="$SCRIPTS/mailbox_note_to_role.sh"
INJECT_SH="$SCRIPTS/inject_note_to_role.sh"
HANDOFFD_BB="$SCRIPTS/handoffd.bb"
MAILBOX_DIR_BB="$SCRIPTS/mailbox_dir.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: opt in - this ROOT is an intentional throwaway test root

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
OUTSIDE="$(cd "$(mktemp -d)" && pwd -P)"
cleanup() { rm -rf "$ROOT" "$OUTSIDE" "${STUBDIR:-}"; }
trap cleanup EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

mkdir -p "$ROOT/.swarmforge" "$ROOT/backlog/paused" "$ROOT/backlog/active" "$ROOT/backlog/done" \
  "$ROOT/specs/features" "$ROOT/extension/out/tools"

printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" \
  > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT" \
  >> "$ROOT/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT" \
  >> "$ROOT/.swarmforge/roles.tsv"

# handoffd.bb --poll-once (used below to drain outbox/ into inbox/new/,
# mirroring mailbox_note_to_role.sh's own self-poll) needs a tmux-socket
# file to exist even though it is never dialed under SWARMFORGE_MAILBOX_ONLY=1.
touch "$ROOT/fake.sock"
echo "$ROOT/fake.sock" > "$ROOT/.swarmforge/tmux-socket"

# A deprecate-check.js stub that ALWAYS holds - not the freshness EVALUATION
# under test here, only enough of the real CLI's contract
# (extension/src/tools/deprecate-check.ts) for promote_and_route_next.sh to
# reach notify_specifier_freshness_hold(), the site this ticket fixes.
cat > "$ROOT/extension/out/tools/deprecate-check.js" <<'EOF'
'use strict';
function interpretFreshnessCliOutput() {
  return { decision: 'hold', reason: 'BL-1537 fixture stub: always hold' };
}
module.exports = { interpretFreshnessCliOutput };
if (require.main === module) {
  process.stdout.write(JSON.stringify({ decision: 'hold', reason: 'BL-1537 fixture stub: always hold' }));
}
EOF

printf 'id: BL-9537\ntitle: "fixture ticket for the freshness hold"\nstatus: paused\npriority: 5\nassigned_to:\n' \
  > "$ROOT/backlog/paused/BL-9537-fixture-ticket.yaml"
: > "$ROOT/specs/features/BL-9537-fixture-ticket.feature"

printf 'id: BL-9538\ntitle: "fixture ticket already active"\nstatus: todo\nassigned_to: coder\n' \
  > "$ROOT/backlog/active/BL-9538-fixture-ticket.yaml"

git -C "$ROOT" add -A
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "fixture backlog"

poll_once() {
  SWARMFORGE_MAILBOX_ONLY=1 bb "$HANDOFFD_BB" "$ROOT" --poll-once >/dev/null 2>&1 || true
}

inbox_count() {
  local role="$1"
  local dir
  dir="$(bb "$MAILBOX_DIR_BB" "$ROOT" "$role" new 2>/dev/null)" || { echo 0; return; }
  find "$dir" -maxdepth 1 -type f -name '*.handoff' 2>/dev/null | wc -l | tr -d '[:space:]'
}

tmp_handoff_count() {
  find "$ROOT/tmp" -maxdepth 1 -type f -name '*.handoff' 2>/dev/null | wc -l | tr -d '[:space:]'
}

outside_file_count() {
  find "$OUTSIDE" -type f 2>/dev/null | wc -l | tr -d '[:space:]'
}

assert_common() {
  local label="$1" out="$2"
  if grep -q 'HANDOFF_DRAFT_OUTSIDE_ROOT' <<< "$out"; then
    fail "$label: draft was refused as outside the root; got: $out"
  fi
  local n
  n="$(outside_file_count)"
  [[ "$n" -eq 0 ]] || fail "$label: TMPDIR ($OUTSIDE) gained $n file(s) - a sender still drafts there"
  n="$(tmp_handoff_count)"
  [[ "$n" -eq 0 ]] || fail "$label: $n leftover draft(s) under \$ROOT/tmp/ - a sender did not clean up on exit"
}

# ── 01: promote_and_route_next.sh's freshness-hold note reaches the specifier
BEFORE="$(inbox_count specifier)"
OUT="$(cd "$ROOT" && TMPDIR="$OUTSIDE" env -u SWARMFORGE_MAILBOX_ONLY -u SWARMFORGE_SKIP_DAEMON \
  SWARMFORGE_ROLE=coordinator SWARMFORGE_SKIP_DAEMON=0 SWARMFORGE_MAILBOX_ONLY=1 \
  bash "$PROMOTE_SH" "$ROOT" 2>&1)"
RC=$?
[[ "$RC" -eq 2 ]] || fail "01: expected the freshness-hold exit (2), got rc=$RC; out: $OUT"
poll_once
AFTER="$(inbox_count specifier)"
(( AFTER > BEFORE )) || fail "01: expected a freshness-hold note in the specifier's inbox/new; out: $OUT"
assert_common "01 [promote_and_route_next.sh]" "$OUT"
pass "01: promote_and_route_next.sh drafts its freshness-hold note under \$ROOT/tmp/ although TMPDIR is outside the root"

# ── 02: route_backlog_to_coder.sh's Work note reaches coder
BEFORE="$(inbox_count coder)"
OUT="$(cd "$ROOT" && TMPDIR="$OUTSIDE" env -u SWARMFORGE_MAILBOX_ONLY -u SWARMFORGE_SKIP_DAEMON \
  SWARMFORGE_SKIP_DAEMON=0 SWARMFORGE_MAILBOX_ONLY=1 SWARMFORGE_ROLE=coordinator \
  bash "$ROUTE_SH" BL-9538 "$ROOT" 2>&1)"
# route_backlog_to_coder.sh's own post-send confirmation check assumes
# synchronous (tmux-inject) delivery and races the mailbox-only queue used
# here to avoid a live tmux dependency, so it may warn and exit non-zero
# even though the handoff itself queued cleanly - the grammar below is what
# proves the send itself was not refused; the recipient's inbox after
# poll_once is what proves delivery (BL-1097's own fixture checks the same
# outbox emission, not this script's exit code, for the identical reason).
grep -q 'HANDOFF QUEUED' <<< "$OUT" || fail "02: expected the Work note to queue; out: $OUT"
poll_once
AFTER="$(inbox_count coder)"
(( AFTER > BEFORE )) || fail "02: expected a Work note in coder's inbox/new; out: $OUT"
assert_common "02 [route_backlog_to_coder.sh]" "$OUT"
pass "02: route_backlog_to_coder.sh drafts its Work note under \$ROOT/tmp/ although TMPDIR is outside the root"

# ── 03: mailbox_note_to_role.sh's note reaches coder
BEFORE="$(inbox_count coder)"
OUT="$(cd "$ROOT" && TMPDIR="$OUTSIDE" env -u SWARMFORGE_MAILBOX_ONLY -u SWARMFORGE_SKIP_DAEMON \
  SWARMFORGE_SKIP_DAEMON=0 SWARMFORGE_ROLE=coordinator \
  bash "$MAILBOX_SH" coder "BL-1537 mailbox probe" 2>&1)"
RC=$?
[[ "$RC" -eq 0 ]] || fail "03: expected mailbox_note_to_role.sh to succeed, got rc=$RC; out: $OUT"
poll_once
AFTER="$(inbox_count coder)"
(( AFTER > BEFORE )) || fail "03: expected a mailbox note in coder's inbox/new; out: $OUT"
assert_common "03 [mailbox_note_to_role.sh]" "$OUT"
pass "03: mailbox_note_to_role.sh drafts its note under \$ROOT/tmp/ although TMPDIR is outside the root"

# ── 04: inject_note_to_role.sh's note reaches coder
BEFORE="$(inbox_count coder)"
OUT="$(cd "$ROOT" && TMPDIR="$OUTSIDE" env -u SWARMFORGE_MAILBOX_ONLY -u SWARMFORGE_SKIP_DAEMON \
  SWARMFORGE_SKIP_DAEMON=0 SWARMFORGE_MAILBOX_ONLY=1 SWARMFORGE_ROLE=coordinator \
  bash "$INJECT_SH" coder "BL-1537 inject probe" 2>&1)"
RC=$?
[[ "$RC" -eq 0 ]] || fail "04: expected inject_note_to_role.sh to succeed, got rc=$RC; out: $OUT"
poll_once
AFTER="$(inbox_count coder)"
(( AFTER > BEFORE )) || fail "04: expected an injected note in coder's inbox/new; out: $OUT"
assert_common "04 [inject_note_to_role.sh]" "$OUT"
pass "04: inject_note_to_role.sh drafts its note under \$ROOT/tmp/ although TMPDIR is outside the root"

# ── 05: notify_specifier_freshness_hold removes its draft even when signalled
# mid-send (declared invariant 2's "signalled" exit path, BL-1537 architect
# bounce D1, 2026-09-12): unlike the other three shell senders, this
# function had no `trap ... EXIT` around its draft, so a SIGTERM between the
# mktemp and the swarm_handoff.sh call left the draft under $ROOT/tmp/
# forever. SCRIPT_DIR inside promote_and_route_next.sh is derived from
# `dirname "$0"`, so invoking it through a symlink in a scratch dir makes
# `$SCRIPT_DIR/swarm_handoff.sh` resolve to a stub we control, in place of
# the real sender, without touching the real script's resolution logic.
STUBDIR="$(mktemp -d)"
for f in "$SCRIPTS"/*; do
  [[ -f "$f" ]] && ln -s "$f" "$STUBDIR/$(basename "$f")"
done
rm -f "$STUBDIR/swarm_handoff.sh"
cat > "$STUBDIR/swarm_handoff.sh" <<'EOF'
#!/usr/bin/env bash
sleep 10
EOF
chmod +x "$STUBDIR/swarm_handoff.sh"

PROMOTE_OUT="$(mktemp)"
(
  cd "$ROOT"
  unset SWARMFORGE_MAILBOX_ONLY SWARMFORGE_SKIP_DAEMON
  export TMPDIR="$OUTSIDE" SWARMFORGE_ROLE=coordinator SWARMFORGE_SKIP_DAEMON=0 SWARMFORGE_MAILBOX_ONLY=1
  exec bash "$STUBDIR/promote_and_route_next.sh" "$ROOT"
) >"$PROMOTE_OUT" 2>&1 &
PROMOTE_PID=$!

DRAFT=""
for _ in $(seq 1 100); do
  DRAFT="$(find "$ROOT/tmp" -maxdepth 1 -type f -name 'swarmforge-freshness-hold.*.handoff' 2>/dev/null | head -1)"
  [[ -n "$DRAFT" ]] && break
  sleep 0.1
done
[[ -n "$DRAFT" ]] || fail "05: expected a freshness-hold draft to appear under \$ROOT/tmp/ before signalling; out: $(cat "$PROMOTE_OUT")"

kill -TERM "$PROMOTE_PID" 2>/dev/null || true
wait "$PROMOTE_PID" 2>/dev/null || true
pkill -f "$STUBDIR/swarm_handoff.sh" 2>/dev/null || true

STILL_PRESENT=1
for _ in $(seq 1 50); do
  if [[ -e "$DRAFT" ]]; then
    sleep 0.1
  else
    STILL_PRESENT=0
    break
  fi
done
[[ "$STILL_PRESENT" -eq 0 ]] || fail "05: draft $DRAFT survived SIGTERM - notify_specifier_freshness_hold has no trap guarding its draft"
rm -rf "$STUBDIR" "$PROMOTE_OUT"
pass "05: notify_specifier_freshness_hold removes its draft even when signalled mid-send"

echo "ALL PASS"
