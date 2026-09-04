#!/usr/bin/env bash
# BL-1379: handoffd.bb's consolidated poll loop also reverses expedition parks.
#
# An expedition parks every other active ticket into backlog/hold/ and nothing
# ever moved them back; Article 3.1 makes hold/ human-held, so the park became
# indistinguishable from a deliberate hold the moment the run ended.
#
# The DECISION logic (per-ticket restore/skip, the freshness mark, idempotence)
# is covered by expedite_lib_test_runner.bb and the BL-1379 acceptance suite.
# This test proves only the WIRING the architect found missing on the first
# pass: that the REAL daemon reaches expedite-park-reversal-sweep! on its own
# cadence, that the sweep reaches expedite_cli.bb's `unpark` subcommand, and
# that a real ticket really moves out of a real backlog/hold/. The reversal was
# fully built and entirely unreachable before this, and nothing said so.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"
SCRIPTS="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/../portable_daemon_spawn_lib.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: an intentional throwaway root
DAEMON_PID=""
cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    mkdir -p "$ROOT/.swarmforge/daemon" 2>/dev/null || true
    touch "$ROOT/.swarmforge/daemon/stop" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
    kill "$DAEMON_PID" 2>/dev/null || true
  fi
  rm -rf "$ROOT"
}
trap cleanup EXIT

TODAY_DAY_KEY="$(date -u +%Y-%m-%d)"
RUN_DIR="$ROOT/.swarmforge/expedite/BL-9001"

mkdir -p "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/docs/briefings" \
  "$ROOT/backlog/active" "$ROOT/backlog/paused" "$ROOT/backlog/hold" "$ROOT/backlog/done" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/new" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/in_process" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/completed" \
  "$RUN_DIR" "$ROOT/swarmforge"
# The sweep shells to $project-root/swarmforge/scripts/expedite_cli.bb, so the
# fixture root exposes the REAL scripts rather than a stub of them.
ln -s "$SCRIPTS" "$ROOT/swarmforge/scripts"

# ── a real repo, a real parked ticket, a real landed expedition ────────────
git init --quiet "$ROOT"
git -C "$ROOT" config user.email "test@example.com"
git -C "$ROOT" config user.name "Test"
git -C "$ROOT" checkout -q -b main
printf 'id: BL-9002\nstatus: todo\n' > "$ROOT/backlog/hold/BL-9002-parked.yaml"
# A ticket a HUMAN put in hold/: never named by the record, so the sweep must
# not touch it (Article 3.1).
printf 'id: BL-9003\nstatus: todo\n' > "$ROOT/backlog/hold/BL-9003-human-held.yaml"
git -C "$ROOT" add -A && git -C "$ROOT" commit -q -m "seed"
git -C "$ROOT" commit -q --allow-empty -m "BL-9001 expedition work"
# The expedition's branch tip is on main: it landed.
git -C "$ROOT" branch expedite/BL-9001

# The run's own park record, in production's own shape.
bb -e "
(require (quote [cheshire.core :as json]))
(load-file \"$SCRIPTS/expedite_lib.bb\")
(spit \"$RUN_DIR/park-record.json\"
      (json/generate-string
       (expedite-lib/park-record {:run-ticket \"BL-9001\"
                                  :parked-tickets [\"BL-9002\"]
                                  :origin-folder \"active\"
                                  :at \"fixture\"})))" >/dev/null

SOCK="$ROOT/fake.sock"
touch "$SOCK"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
cat > "$ROOT/.swarmforge/roles.tsv" <<TSV
coordinator	master	$ROOT	swarmforge-coordinator	Coordinator	claude	task
TSV
# Neutralize the unrelated briefing-generation sweep, as the sibling wiring
# tests do.
printf 'Headline: unrelated\n' > "$ROOT/docs/briefings/${TODAY_DAY_KEY}.md"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
printf '#!/usr/bin/env bash\nexit 0\n' > "$FAKE_BIN/tmux"
chmod +x "$FAKE_BIN/tmux"

LOG_FILE="$ROOT/.swarmforge/daemon/handoffd.log"
portable_spawn_daemon_or_fail bb \
  env -u TELEGRAM_BOT_TOKEN -u TELEGRAM_CHAT_ID -u RESEND_API_KEY \
  PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT"
DAEMON_PID=$!

wait_for() { # <predicate-command> <timeout-s>
  local timeout_s="$2" waited=0
  while (( waited < timeout_s * 4 )); do
    eval "$1" >/dev/null 2>&1 && return 0
    sleep 0.25
    waited=$((waited + 1))
  done
  return 1
}

wait_for "test -f '$ROOT/backlog/active/BL-9002-parked.yaml'" 60 \
  || fail "the parked ticket never returned to backlog/active/ within 60s; log: $(cat "$LOG_FILE" 2>/dev/null)"
pass "the real daemon reaches the sweep, and the sweep reaches expedite_cli.bb's unpark subcommand"

grep -q "expedite-park-reversal " "$LOG_FILE" \
  || fail "the sweep restored the ticket but logged nothing; log: $(cat "$LOG_FILE")"
grep -q "expedite-park-reversal-error" "$LOG_FILE" \
  && fail "the sweep threw; log: $(cat "$LOG_FILE")"
pass "the sweep reports what it did and never threw"

grep -q '^status: blocked' "$ROOT/backlog/active/BL-9002-parked.yaml" \
  || fail "the restored ticket is workable again; got: $(cat "$ROOT/backlog/active/BL-9002-parked.yaml")"
grep -q 'BL-9001' "$ROOT/backlog/active/BL-9002-parked.yaml" \
  || fail "the freshness mark does not name the expedition that parked it; got: $(cat "$ROOT/backlog/active/BL-9002-parked.yaml")"
pass "the restored ticket is blocked pending an Article 3.6 freshness check naming its expedition"

[[ -f "$RUN_DIR/unpark-done.json" ]] \
  || fail "the settled run was never marked done, so the sweep will shell for it on every tick forever"
pass "a settled run is marked done and drops out of the sweep"

[[ -f "$ROOT/backlog/hold/BL-9003-human-held.yaml" ]] \
  || fail "the sweep emptied a ticket out of hold/ that no record named - Article 3.1 breach"
pass "a ticket a human placed in hold/ is untouched: the sweep sees only its own record"

echo "ALL PASS"
