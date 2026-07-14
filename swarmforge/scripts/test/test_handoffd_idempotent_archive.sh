#!/usr/bin/env bash
# BL-083: handoffd's archive step (outbox -> sent) must be idempotent. A
# duplicate handoffd (BL-081 leak) or a crash-restart retry can race the
# same outbox file: the loser finds the file already gone from outbox and
# already present in sent/, and must treat that as a completed delivery
# rather than writing a misleading .error stub next to the delivered file.
#
# Covers acceptance scenarios BL-083 idempotent-archive-01..03.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT" \
  > "$ROOT/.swarmforge/roles.tsv"

OUTBOX="$ROOT/.swarmforge/handoffs/outbox"
SENT="$ROOT/.swarmforge/handoffs/sent"
FAILED="$ROOT/.swarmforge/handoffs/failed"
mkdir -p "$OUTBOX" "$SENT"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

# ── 01: file already archived (present in sent/) but the outbox attempt
# still errors (e.g. a stale duplicate delivery hits an unrelated failure,
# such as BL-081's dup-daemon race re-processing a file another daemon
# already fully delivered and archived). The already-in-sent/ check must
# win over writing a misleading .error stub.
NAME_01="50_20260703T000001Z_000001_from_coder_to_ghost.handoff"
printf 'id: %s\nfrom: coder\nto: ghost\npriority: 50\ntype: note\nmessage: already-sent\ncreated_at: 2026-07-03T00:00:00Z\n\nalready-sent\n' \
  "$NAME_01" > "$SENT/$NAME_01"
printf 'id: %s\nfrom: coder\nto: ghost\npriority: 50\ntype: note\nmessage: already-sent\ncreated_at: 2026-07-03T00:00:00Z\n\nalready-sent\n' \
  "$NAME_01" > "$OUTBOX/$NAME_01"

PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!
for _ in $(seq 1 40); do
  [[ -f "$OUTBOX/$NAME_01" ]] || break
  sleep 0.25
done
mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true

[[ -f "$SENT/$NAME_01" ]] || fail "01: expected sent copy to remain untouched"
[[ -f "$OUTBOX/$NAME_01.error" ]] && fail "01: no .error stub should exist for an already-archived file"
[[ -f "$FAILED/$NAME_01.error" ]] && fail "01: no .error stub should exist in failed/ either"
pass "01: already-archived file produces no .error stub"

# ── 02: genuine archive failure produces a diagnostic stub ──────────────────
NAME_02="50_20260703T000002Z_000002_from_coder_to_ghost.handoff"
printf 'id: %s\nfrom: coder\nto: ghost\npriority: 50\ntype: note\nmessage: bad-recipient\ncreated_at: 2026-07-03T00:00:00Z\n\nbad-recipient\n' \
  "$NAME_02" > "$OUTBOX/$NAME_02"

PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!
for _ in $(seq 1 40); do
  [[ -f "$FAILED/$NAME_02" || -f "$FAILED/$NAME_02.error" ]] && break
  sleep 0.25
done
mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true

[[ -f "$FAILED/$NAME_02" ]] || fail "02: expected genuinely-failed handoff to land in failed/"
STUB="$FAILED/$NAME_02.error"
[[ -f "$STUB" ]] || fail "02: expected a .error stub for the genuine failure"
STUB_BODY="$(cat "$STUB")"
[[ "$STUB_BODY" != "$FAILED/$NAME_02" && "$STUB_BODY" != "$OUTBOX/$NAME_02" ]] \
  || fail "02: stub body must be a diagnostic reason, not just the file path; got: $STUB_BODY"
[[ "$STUB_BODY" == *"ghost"* || "$STUB_BODY" == *"recipient"* ]] \
  || fail "02: stub body should explain WHY (mention the bad recipient); got: $STUB_BODY"
pass "02: genuine archive failure produces a diagnostic .error stub"

# ── 03: startup self-heal of a stale stub whose original is in sent/ ────────
NAME_03="50_20260703T000003Z_000003_from_coder_to_coder.handoff"
printf 'id: %s\nfrom: coder\nto: coder\npriority: 50\ntype: note\nmessage: stale-stub\ncreated_at: 2026-07-03T00:00:00Z\n\nstale-stub\n' \
  "$NAME_03" > "$SENT/$NAME_03"
echo "stale diagnostic" > "$OUTBOX/$NAME_03.error"

PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" --startup-notify-only >/dev/null 2>&1 || true

[[ -f "$OUTBOX/$NAME_03.error" ]] && fail "03: stale .error stub should be removed on startup"
grep -q "stale-stub-cleanup\|self-heal" "$ROOT/.swarmforge/daemon/handoffd.log" \
  || fail "03: expected a log line recording the stale-stub cleanup"
pass "03: startup self-heal removes a stale .error stub and logs it"

echo "ALL PASS"
