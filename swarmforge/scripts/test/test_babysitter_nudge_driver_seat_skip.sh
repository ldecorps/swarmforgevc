#!/usr/bin/env bash
# BL-1698 D1 (QA bounce 2026-09-25): scenario 06 ("babysitterd nudges a
# Claude seat and never a driver seat") must drive babysitterd's OWN nudge
# pass (babysitter_nudge_lib.bb's nudge-resident!) through its live
# consumer, not handoffd's wake path (test_handoffd_driver_seat_injection_skip.sh
# proves invariant 2 for handoffd; this proves the SAME property for
# babysitterd, which is a separate call site with its own aider-agent?
# check plus BL-1698's new driver-seat? one). Same fake-tmux convention as
# that test: an echo-and-succeed tmux stub, since nudge-resident!'s
# verified-submit loop only needs a successful send, never a specific
# reply.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NUDGE_LIB="$SCRIPT_DIR/../babysitter_nudge_lib.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
{
  printf 'coder\tcoder\t%s\tsf-coder\tCoder\taider\ttask\n' "$ROOT"
  printf 'cleaner\tcleaner\t%s\tsf-cleaner\tCleaner\tclaude\ttask\n' "$ROOT"
} > "$ROOT/.swarmforge/roles.tsv"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
TMUX_LOG="$ROOT/tmux-calls.log"
export TMUX_LOG
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$TMUX_LOG"
if [[ "$*" == *capture-pane* ]]; then
  echo "idle, work pending"
fi
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

RESULT="$(PATH="$FAKE_BIN:$PATH" bb -e "
(load-file \"$NUDGE_LIB\")
(println (babysitter-nudge-lib/format-cli-line
          (babysitter-nudge-lib/nudge-resident! \"$ROOT\" \"coder\" \"wake up\")))
(println (babysitter-nudge-lib/format-cli-line
          (babysitter-nudge-lib/nudge-resident! \"$ROOT\" \"cleaner\" \"wake up\")))
")"

echo "$RESULT" | grep -q '^SKIP_AIDER_AGENT: coder' \
  || fail "01: the coder (aider driver) seat must be skipped by nudge-resident! ($RESULT)"
pass "01: the coder (driver) seat's aider pane received no typed text from babysitterd's nudge pass"

echo "$RESULT" | grep -q '^NUDGED: cleaner' \
  || fail "02: the cleaner (non-driver) seat must still be nudged ($RESULT)"
pass "02: a Claude seat with work still received its wake (babysitterd's own nudge pass unchanged)"

[[ -f "$TMUX_LOG" ]] || fail "no tmux calls recorded at all"
grep -q -- "send-keys.*sf-coder" "$TMUX_LOG" \
  && fail "03: the coder (driver) seat's pane received a tmux send-keys - invariant violated"
pass "03: no tmux send-keys ever reached the coder (driver) seat's pane"

grep -q -- "send-keys.*sf-cleaner" "$TMUX_LOG" \
  || fail "04: the cleaner seat's pane received no tmux send-keys at all"
pass "04: the cleaner (non-driver) seat's pane received a real tmux send-keys"

# BL-1698 architect bounce (2026-09-25, D1): aider is CURRENTLY the only
# :parcel-driver true provider, and its :wake-style (:shell-run-script)
# already trips the earlier aider-agent? clause - so nothing above can
# tell the driver-seat? clause apart from not existing at all. Proves it
# directly against a stubbed driver-capable provider whose :wake-style is
# NOT :shell-run-script (a real capability shape a future non-aider
# driver provider could have), so this fails whenever driver-seat? (or its
# cond placement) regresses, regardless of which provider is aider today.
{
  printf 'localdriver\tcoder\t%s\tsf-localdriver\tLocalDriver\tfake-non-aider-driver\ttask\n' "$ROOT"
} >> "$ROOT/.swarmforge/roles.tsv"

RESULT2="$(PATH="$FAKE_BIN:$PATH" bb -e "
(load-file \"$NUDGE_LIB\")
(with-redefs [prompt-engine-lib/capabilities
              (fn [agent] (if (= agent \"fake-non-aider-driver\")
                            {:wake-style :chat-message :parcel-driver true}
                            (prompt-engine-lib/capabilities agent)))]
  (println (babysitter-nudge-lib/format-cli-line
            (babysitter-nudge-lib/nudge-resident! \"$ROOT\" \"localdriver\" \"wake up\"))))
")"

echo "$RESULT2" | grep -q '^SKIP_DRIVER_SEAT: localdriver' \
  || fail "05: a driver-capable, non-aider seat must be skipped by driver-seat? (got: $RESULT2)"
pass "05: a driver-capable seat with a non-aider (:chat-message) wake style is skipped by driver-seat?, not just aider-agent?"

grep -q -- "send-keys.*sf-localdriver" "$TMUX_LOG" \
  && fail "06: the driver-capable non-aider seat's pane received a tmux send-keys - driver-seat? did not skip it"
pass "06: no tmux send-keys ever reached the driver-capable non-aider seat's pane"

echo "ALL PASS"
