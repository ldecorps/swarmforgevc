#!/usr/bin/env bash
# hotfix outbox-race (2026-09-02): handoffd.bb's poll-once! listed a role's
# outbox and then slurped each parcel OUTSIDE the try that wraps deliver!.
# A parcel the sending role archived between the listing and the read threw
# java.io.FileNotFoundException through poll-once! and killed the daemon -
# and because handoffd_supervisor.bb alarm-and-halts on a dead daemon, the
# whole swarm (tmux server + every role pane) went down with it. Four times
# on 2026-09-02 (11:18, 12:14, 14:54, 15:25), same signature on 2026-08-30.
#
# The race itself is not deterministic, so this fixture uses the one thing
# that reproduces the exact failure class on demand: a parcel that IS listed
# (a regular *.handoff file) but CANNOT be read (mode 000). Before the fix
# the daemon dies on it; after, it logs the skip, keeps polling, and still
# delivers the sibling parcel behind it.
#
# Same real-daemon / fake-tmux scaffold as test_handoffd_ambulance_wiring.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

if [[ "$(id -u)" == "0" ]]; then
  echo "SKIP: mode-000 is readable by root; this fixture needs an unprivileged user"; exit 0
fi

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1
PID=""
cleanup() {
  local exit_code=$?
  [[ -n "$PID" ]] && kill "$PID" 2>/dev/null || true
  chmod -R u+rw "$ROOT" 2>/dev/null || true
  rm -rf "$ROOT" 2>/dev/null || echo "WARN: cleanup could not remove fixture root: $ROOT" >&2
  return "$exit_code"
}
trap cleanup EXIT

SOCK="$ROOT/fake.sock"; touch "$SOCK"
mkdir -p "$ROOT/.swarmforge" "$ROOT/backlog/active" "$ROOT/.swarmforge/daemon"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
CODER_WT="$ROOT/.worktrees/coder"
CLEANER_INBOX_NEW="$ROOT/.worktrees/cleaner/.swarmforge/handoffs/inbox/new"
mkdir -p "$CODER_WT/.swarmforge/handoffs/outbox" "$CLEANER_INBOX_NEW"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" > "$ROOT/.swarmforge/roles.tsv"
printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$ROOT/.worktrees/cleaner" >> "$ROOT/.swarmforge/roles.tsv"
printf '{"active":false}\n' > "$ROOT/.swarmforge/operator/control-ambulance.json" 2>/dev/null || { mkdir -p "$ROOT/.swarmforge/operator"; printf '{"active":false}\n' > "$ROOT/.swarmforge/operator/control-ambulance.json"; }

# Parcel 1 sorts FIRST and is unreadable; parcel 2 is a normal note behind it.
UNREADABLE="$CODER_WT/.swarmforge/handoffs/outbox/50_20260902T000001Z_000001_from_coder_to_cleaner.handoff"
SIBLING="$CODER_WT/.swarmforge/handoffs/outbox/50_20260902T000002Z_000002_from_coder_to_cleaner.handoff"
printf 'id: n1\nfrom: coder\nto: cleaner\npriority: 50\ntype: note\ncreated_at: 2026-09-02T00:00:01Z\n\nvanishing parcel\n' > "$UNREADABLE"
printf 'id: n2\nfrom: coder\nto: cleaner\npriority: 50\ntype: note\ncreated_at: 2026-09-02T00:00:02Z\n\nsibling parcel\n' > "$SIBLING"
chmod 000 "$UNREADABLE"

FAKE_BIN="$ROOT/bin"; mkdir -p "$FAKE_BIN"
printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_BIN/tmux"; chmod +x "$FAKE_BIN/tmux"
LOG="$ROOT/.swarmforge/daemon/handoffd.log"

PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" > "$ROOT/daemon-stdout.log" 2>&1 &
PID=$!

wait_for() {
  local file="$1" pattern="$2" timeout_s="$3" waited=0
  while (( waited < timeout_s * 4 )); do
    [[ -f "$file" ]] && grep -q "$pattern" "$file" 2>/dev/null && return 0
    sleep 0.25; waited=$((waited + 1))
  done
  return 1
}

# ── 01: the unreadable parcel is skipped with a named log line, never fatal ──
wait_for "$LOG" "outbox-parcel-unreadable" 15 \
  || fail "01: expected the daemon to log 'outbox-parcel-unreadable' for the mode-000 parcel and carry on; daemon stdout: $(tail -20 "$ROOT/daemon-stdout.log" 2>/dev/null); log: $(cat "$LOG" 2>/dev/null)"
pass "01: a listed-but-unreadable outbox parcel is logged as unreadable instead of throwing through poll-once!"

# ── 02: the daemon is still alive several polls later ─────────────────────
sleep 3
kill -0 "$PID" 2>/dev/null || fail "02: the daemon died after meeting the unreadable parcel; stdout: $(tail -20 "$ROOT/daemon-stdout.log" 2>/dev/null)"
grep -q "Exception" "$ROOT/daemon-stdout.log" 2>/dev/null && fail "02: an exception escaped the poll loop: $(grep -m3 -A3 'Exception' "$ROOT/daemon-stdout.log")"
pass "02: the daemon survives the unreadable parcel and keeps polling (no escaped exception)"

# ── 03: the sibling parcel behind it is still delivered ───────────────────
for _ in $(seq 1 40); do
  grep -lq "sibling parcel" "$CLEANER_INBOX_NEW"/*.handoff 2>/dev/null && break
  sleep 0.25
done
grep -lq "sibling parcel" "$CLEANER_INBOX_NEW"/*.handoff 2>/dev/null \
  || fail "03: expected the readable sibling parcel to reach cleaner's inbox; log: $(cat "$LOG" 2>/dev/null)"
[[ ! -f "$SIBLING" ]] || fail "03: the delivered sibling should have left coder's outbox"
pass "03: the readable parcel behind the unreadable one is delivered normally"

# ── 04: the unreadable parcel is left exactly where it was (never moved) ──
[[ -f "$UNREADABLE" ]] || fail "04: the unreadable parcel must stay in the outbox untouched for a later poll (or a human)"
pass "04: the unreadable parcel stays in place, byte-untouched, for the next poll"

touch "$ROOT/.swarmforge/daemon/stop"
wait "$PID" 2>/dev/null || true
PID=""
echo "ALL PASS: handoffd outbox vanished-parcel wiring"
