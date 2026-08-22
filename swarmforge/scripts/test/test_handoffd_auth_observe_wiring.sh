#!/usr/bin/env bash
# BL-536: wiring smoke test proving handoffd.bb's REAL chase-sweep! actually
# reaches the auth-class observer (observe-standing-role-auth! ->
# do-auth-respawn!) and issues a real (fake) tmux respawn-pane call carrying
# provider-compat env args, when a live standing-role pane shows auth-class
# scrollback. The DECISION logic itself (attempt cap, alert-once, quiet
# after cap) is exhaustively covered by
# provider_auth_observe_lib_test_runner.bb and
# provider_auth_observe_lib_property_runner.bb; this test only proves the
# real daemon's live observe path is actually wired to it (required_wiring
# in the ticket YAML) - the same "light wiring smoke test" scope as
# test_handoffd_chase_sweep_wiring.sh next to it. The full multi-tick
# attempt-cap/alert e2e matrix on a scratch tmux socket is QA's own
# procedure, per this ticket's notes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # intentional throwaway test root
DAEMON_PID=""
cleanup() {
  [[ -n "$DAEMON_PID" ]] && kill "$DAEMON_PID" 2>/dev/null || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/.swarmforge/daemon"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
# A single standing role with an EMPTY mailbox - isolates the observed
# tmux calls to the auth-observe path alone (no chase/dispatch-gap activity
# to also produce a respawn/wake for an unrelated reason).
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
TMUX_LOG="$ROOT/tmux-calls.log"
export TMUX_LOG
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$TMUX_LOG"
if [[ "$1 $2 $3" == "-S "*"has-session" ]]; then
  exit 0  # session exists
fi
if [[ "$1 $2 $3" == "-S "*"capture-pane" ]]; then
  # An auth-class scrollback line, exactly as classify-provider-error /
  # provider-auth-error-text? recognize (SRE incident 2026-07-19's own text).
  echo "AuthenticationError: Invalid API key provided"
  exit 0
fi
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

# A configured Cerebras key + use-flag: proves the respawn genuinely reused
# provider-respawn-env-lib's real machinery (not a bare respawn-pane with no
# env args at all).
export SWARMFORGE_USE_CEREBRAS=1
export CEREBRAS_API_KEY="fake-cerebras-key-for-wiring-test"

PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!

for _ in $(seq 1 40); do
  grep -q "respawn-pane" "$TMUX_LOG" 2>/dev/null && break
  sleep 0.25
done
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true

# ── 01: the real chase-sweep! reached the auth observer and respawned ──────
grep -q "respawn-pane" "$TMUX_LOG" || fail "01: no respawn-pane call was ever issued - auth-observe path did not fire"
pass "01: the real daemon's chase sweep observed the auth-class pane and issued a respawn"

# ── 02: the respawn carried provider-compat env args (real machinery, not
#    a bare respawn) ─────────────────────────────────────────────────────
grep "respawn-pane" "$TMUX_LOG" | grep -q "CEREBRAS_API_KEY=fake-cerebras-key-for-wiring-test" \
  || fail "02: respawn-pane call did not carry the configured provider-compat env (CEREBRAS_API_KEY) - not the real provider-respawn-env-args machinery"
grep "respawn-pane" "$TMUX_LOG" | grep -q "SWARMFORGE_USE_CEREBRAS=1" \
  || fail "02: respawn-pane call missing SWARMFORGE_USE_CEREBRAS=1"
pass "02: the respawn was issued with real provider-compat env args (swarm_ensure.bb's own machinery, reused)"

# ── 03: respawn-pane force-relaunches the role's own persisted launch script ─
grep "respawn-pane" "$TMUX_LOG" | grep -q -- "-k" \
  || fail "03: respawn-pane call missing -k (force kill+relaunch)"
pass "03: the respawn force-relaunches the role's session (respawn-pane -k)"
