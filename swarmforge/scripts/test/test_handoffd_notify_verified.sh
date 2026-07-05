#!/usr/bin/env bash
# BL-093: handoffd.bb's notify! used to fire-and-forget send-keys - a lost
# Enter left the wake message typed-but-unsubmitted with no signal anywhere.
# These tests drive the real notify! (via handoffd.bb's --startup-notify-only
# path, which calls it directly against a role with a pending inbox item)
# against a fake tmux whose capture-pane response is controlled per scenario.
# Covers BL-093 verified-submit-01/02 and no-stacking-03 for the handoffd
# seam specifically (tmuxClient.ts/verifiedInject.ts cover the extension
# seam in extension/test/).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

CODER_WT="$ROOT/.worktrees/coder"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" \
  > "$ROOT/.swarmforge/roles.tsv"

mkdir -p "$CODER_WT/.swarmforge/handoffs/inbox/new"
printf 'type: git_handoff\nto: coder\npriority: 50\ntask: BL-093\n' \
  > "$CODER_WT/.swarmforge/handoffs/inbox/new/50_test_pending.handoff"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
CALL_LOG="$ROOT/tmux-calls.log"
# capture-pane's reply is sequenced: the FIRST call (the pre-inject "is
# anything already pending?" check) returns BEFORE_STDOUT_FILE; every call
# after that (post-Enter verification, retried as many times as configured)
# returns AFTER_STDOUT_FILE. This lets a scenario simulate "idle pane, then
# the typed text gets stuck" distinctly from "already stuck before we even
# typed anything".
BEFORE_STDOUT_FILE="$ROOT/before-stdout.txt"
AFTER_STDOUT_FILE="$ROOT/after-stdout.txt"
CAPTURE_COUNT_FILE="$ROOT/capture-count"
export CALL_LOG BEFORE_STDOUT_FILE AFTER_STDOUT_FILE CAPTURE_COUNT_FILE

cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$CALL_LOG"
for arg in "$@"; do
  if [[ "$arg" == "capture-pane" ]]; then
    count="$(cat "$CAPTURE_COUNT_FILE" 2>/dev/null || echo 0)"
    echo $((count + 1)) > "$CAPTURE_COUNT_FILE"
    if [[ "$count" == "0" ]]; then
      cat "$BEFORE_STDOUT_FILE" 2>/dev/null
    else
      cat "$AFTER_STDOUT_FILE" 2>/dev/null
    fi
    exit 0
  fi
done
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

run_notify() {
  : > "$CALL_LOG"
  echo 0 > "$CAPTURE_COUNT_FILE"
  rm -rf "$ROOT/.swarmforge/daemon"
  PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" --startup-notify-only >/dev/null 2>&1
}

literal_send_count() {
  grep -c -- '-l' "$CALL_LOG" || true
}

# ── 1: healthy pane - idle before, and stays clear after Enter ──────────────
echo '❯ ' > "$BEFORE_STDOUT_FILE"
echo '❯ ' > "$AFTER_STDOUT_FILE"
run_notify
[[ "$(literal_send_count)" == "1" ]] || fail "01: expected exactly one literal send-keys call, got $(literal_send_count)"
grep -q "C-m" "$CALL_LOG" || fail "01: expected a C-m submit"
! grep -q "notify-delivery-failed" "$ROOT/.swarmforge/daemon/handoffd.log" 2>/dev/null \
  || fail "01: a healthy pane must not log a delivery failure"
pass "01: healthy pane confirms submit on the first try, no failure logged"

# ── 2: idle before typing, but the typed wake message then gets stuck - a
#       real lost-Enter case, not a pre-existing stack ─────────────────────
echo '❯ ' > "$BEFORE_STDOUT_FILE"
echo '❯ You have new handoff mail. If idle, run ready_for_next.sh.' > "$AFTER_STDOUT_FILE"
run_notify
[[ "$(literal_send_count)" == "1" ]] || fail "02: must type the wake message exactly once, never re-type on retry, got $(literal_send_count)"
grep -q "notify-delivery-failed" "$ROOT/.swarmforge/daemon/handoffd.log" \
  || fail "02: a wedged pane must log a delivery failure, log: $(cat "$ROOT/.swarmforge/daemon/handoffd.log" 2>/dev/null)"
pass "02: wedged pane exhausts retries, reports failure, never stacks a retype"

# ── 3: pane already holds unrelated undelivered input before notify! runs -
#       must not type a new copy on top of it, and it never clears either ──
echo '❯ bash .swarmforge/launch/specifier.sh' > "$BEFORE_STDOUT_FILE"
cp "$BEFORE_STDOUT_FILE" "$AFTER_STDOUT_FILE"
run_notify
[[ "$(literal_send_count)" == "0" ]] || fail "03: must not type a new copy when the pane already holds undelivered input, got $(literal_send_count)"
grep -q "notify-delivery-failed" "$ROOT/.swarmforge/daemon/handoffd.log" \
  || fail "03: recovering a stuck pre-existing instruction that never clears must still be reported"
pass "03: never stacks a second copy onto pre-existing pending input"

# ── 4: pane already holds unrelated undelivered input, but a plain Enter
#       recovers it (the previous run's lost Enter, not actually wedged) ───
echo '❯ bash .swarmforge/launch/specifier.sh' > "$BEFORE_STDOUT_FILE"
echo '❯ ' > "$AFTER_STDOUT_FILE"
run_notify
[[ "$(literal_send_count)" == "0" ]] || fail "04: recovering pre-existing pending input must never type a new copy, got $(literal_send_count)"
! grep -q "notify-delivery-failed" "$ROOT/.swarmforge/daemon/handoffd.log" 2>/dev/null \
  || fail "04: successfully recovering the pending line must not be reported as a failure"
pass "04: pre-existing pending input that clears on Enter is recovered, not retyped, not reported as a failure"

# ── 5: BL-109 - idle pane whose last rendered line is the standing Claude
#       Code status footer (no $/#/❯/> marker present). Must be typed into,
#       not misread as forever-pending text ─────────────────────────────────
echo '  ⏵⏵ bypass permissions on (shift+tab to cycle)                    /rc' > "$BEFORE_STDOUT_FILE"
echo '❯ ' > "$AFTER_STDOUT_FILE"
run_notify
[[ "$(literal_send_count)" == "1" ]] || fail "05: idle footer must not block the real wake message from being typed, got $(literal_send_count)"
! grep -q "notify-delivery-failed" "$ROOT/.swarmforge/daemon/handoffd.log" 2>/dev/null \
  || fail "05: a successful delivery past the idle footer must not be reported as a failure"
pass "05: idle status footer with no marker is never mistaken for pending input"

echo "ALL PASS"
