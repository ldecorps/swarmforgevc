#!/usr/bin/env bash
# BL-763: behavioural proof that start_ancillary_services.sh starts the
# Cursor Remote bridge exactly when configured and not skipped. Runs the
# REAL start_ancillary_services.sh end to end against fixture roots, every
# other ancillary skipped, and a FAKE start_cursor_bridge.sh standing in for
# the real supervised launcher (already covered by
# test_start_stop_cursor_bridge.sh) — this test is about the GATE, not the
# supervisor's own startup mechanics.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

# Every ancillary except cursor bridge is skipped so this test exercises
# only the gate under test.
SKIP_ENV=(
  SWARMFORGE_SKIP_OPERATOR=1
  SWARMFORGE_SKIP_FRONT_DESK=1
  SWARMFORGE_SKIP_ONBOARDER=1
  SWARMFORGE_SKIP_BABYSITTERD=1
  SWARMFORGE_SKIP_FRESHNESS_CRON=1
  SWARMFORGE_SKIP_TUNNEL=1
  SWARMFORGE_SKIP_RESIDENT_SPY_TUNNEL=1
)

# start_ancillary_services.sh unconditionally `source`s $HOME/.zshenv - on a
# live operator host that can define real TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID/
# TELEGRAM_PRINCIPAL_USER_ID, which would leak into every scenario below
# regardless of what env -u strips from the launch itself. `env -i` plus an
# empty $HOME (same isolation test_ancillary_provider_lib.sh already uses)
# is the only way to make the credential-absent case hermetic.
#
# A present-but-EMPTY .zshenv (not an absent one) is deliberate: under stock
# macOS bash 3.2, `source <missing-file> 2>/dev/null || true` does NOT get
# rescued by `|| true` under `set -e` (a pre-existing bash-3.2 quirk in
# start_ancillary_services.sh itself, unrelated to this ticket - confirmed
# with `bash -c 'set -e; source /no/such/file || true; echo reached'`
# exiting 1 without ever reaching the echo). Sourcing an EMPTY file succeeds
# trivially and sidesteps it without touching production code out of scope.
HOME_EMPTY="$(mktemp -d)"
register_tmp_dir "$HOME_EMPTY"
: > "$HOME_EMPTY/.zshenv"

make_fixture() {
  local d marker
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/swarmforge/scripts"
  cp "$SRC/start_ancillary_services.sh" "$d/swarmforge/scripts/"
  marker="$d/cursor-bridge-started.marker"
  cat > "$d/swarmforge/scripts/start_cursor_bridge.sh" <<EOF
#!/usr/bin/env bash
echo "\$\$" > "$marker"
exit 0
EOF
  chmod +x "$d/swarmforge/scripts/start_cursor_bridge.sh"
  printf '%s' "$d"
}

MARKER_FOR() { echo "$1/cursor-bridge-started.marker"; }
START_IN() { echo "$1/swarmforge/scripts/start_ancillary_services.sh"; }

run_isolated() {
  local root=$1; shift
  env -i HOME="$HOME_EMPTY" PATH="$PATH" "${SKIP_ENV[@]}" "$@" \
    bash "$(START_IN "$root")" "$root" >/dev/null 2>&1
}

F="$(make_fixture)"
run_isolated "$F" CURSOR_BRIDGE_BOT_TOKEN=x TELEGRAM_CHAT_ID=x TELEGRAM_PRINCIPAL_USER_ID=x
check "credentials present + not skipped: cursor bridge is started" \
  '[[ -f "$(MARKER_FOR "$F")" ]]'
rm -rf "$F"

F="$(make_fixture)"
run_isolated "$F" SWARMFORGE_SKIP_CURSOR_BRIDGE=1 \
  CURSOR_BRIDGE_BOT_TOKEN=x TELEGRAM_CHAT_ID=x TELEGRAM_PRINCIPAL_USER_ID=x
check "SWARMFORGE_SKIP_CURSOR_BRIDGE=1 wins even with credentials present" \
  '[[ ! -f "$(MARKER_FOR "$F")" ]]'
rm -rf "$F"

F="$(make_fixture)"
run_isolated "$F"
check "no credentials: cursor bridge is not started" \
  '[[ ! -f "$(MARKER_FOR "$F")" ]]'
rm -rf "$F"

F="$(make_fixture)"
run_isolated "$F" TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=x TELEGRAM_PRINCIPAL_USER_ID=x
check "TELEGRAM_BOT_TOKEN alone (no CURSOR_BRIDGE_BOT_TOKEN) also satisfies the gate" \
  '[[ -f "$(MARKER_FOR "$F")" ]]'
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "start_ancillary_services_cursor_bridge_gate: ALL CHECKS PASSED"
else
  echo "start_ancillary_services_cursor_bridge_gate: FAILURES"; exit 1
fi
