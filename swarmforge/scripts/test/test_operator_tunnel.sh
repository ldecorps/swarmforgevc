#!/usr/bin/env bash
# Smoke test for operator_tunnel.sh — the resilient remote-access tunnel
# supervisor. Exercises every state transition against isolated temp fixtures
# with a FAKE `code` CLI (no network, no real tunnel, no GitHub auth). Asserts
# the disabled / missing-cli / needs-auth / running / auth-lost / stop gating
# and that tunnel.status.json carries the published URL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TUNNEL="$SCRIPT_DIR/../operator_tunnel.sh"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

# A fake project root with a fake CLI whose behaviour is scripted per test.
make_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/operator/vscode-cli"
  printf '%s' "$d"
}
# Install a fake `code` that prints $FAKE_OUT then sleeps so it stays "alive".
install_fake_cli() { # dir out-line
  local cli="$1/.swarmforge/operator/vscode-cli/code"
  cat > "$cli" <<EOF
#!/usr/bin/env bash
printf '%s\n' "$2"
sleep 30
EOF
  chmod +x "$cli"
}
jget() { bb -e "(require '[cheshire.core :as j]) (println (get (j/parse-string (slurp \"$1\") true) $2))"; }

# ── 1. disabled via SWARMFORGE_SKIP_TUNNEL ───────────────────────────────────
F="$(make_fixture)"; install_fake_cli "$F" "ignored"
SWARMFORGE_SKIP_TUNNEL=1 bash "$TUNNEL" ensure "$F" >/dev/null
check "SKIP_TUNNEL -> state disabled" '[[ "$(jget "$F/.swarmforge/operator/tunnel.status.json" ":state")" == disabled ]]'
rm -rf "$F"

# ── 2. missing CLI ───────────────────────────────────────────────────────────
F="$(make_fixture)"   # no CLI installed
bash "$TUNNEL" ensure "$F" >/dev/null
check "no binary -> state missing_cli" '[[ "$(jget "$F/.swarmforge/operator/tunnel.status.json" ":state")" == missing_cli ]]'
rm -rf "$F"

# ── 3. authed sentinel absent -> needs_auth, nothing launched ────────────────
F="$(make_fixture)"; install_fake_cli "$F" "https://vscode.dev/tunnel/x/y"
bash "$TUNNEL" ensure "$F" >/dev/null
check "no sentinel -> state needs_auth" '[[ "$(jget "$F/.swarmforge/operator/tunnel.status.json" ":state")" == needs_auth ]]'
check "no tunnel pid written"           '[[ ! -f "$F/.swarmforge/operator/tunnel.pid" ]]'
rm -rf "$F"

# ── 4. authed + down -> launches, running, URL captured ──────────────────────
F="$(make_fixture)"; install_fake_cli "$F" "Open this link: https://vscode.dev/tunnel/swarmforge-ops/abc123"
touch "$F/.swarmforge/operator/tunnel.authed"
bash "$TUNNEL" ensure "$F" >/dev/null
check "authed+down -> state running"    '[[ "$(jget "$F/.swarmforge/operator/tunnel.status.json" ":state")" == running ]]'
check "url extracted from log"          '[[ "$(jget "$F/.swarmforge/operator/tunnel.status.json" ":url")" == "https://vscode.dev/tunnel/swarmforge-ops/abc123" ]]'
check "pid file written"                '[[ -f "$F/.swarmforge/operator/tunnel.pid" ]]'
# second ensure is idempotent: already alive -> still running, same pid
PID1="$(cat "$F/.swarmforge/operator/tunnel.pid")"
bash "$TUNNEL" ensure "$F" >/dev/null
check "idempotent: still running"       '[[ "$(jget "$F/.swarmforge/operator/tunnel.status.json" ":state")" == running ]]'
check "idempotent: pid unchanged"       '[[ "$(cat "$F/.swarmforge/operator/tunnel.pid")" == "$PID1" ]]'
# stop tears it down
bash "$TUNNEL" stop "$F" >/dev/null
check "stop -> state stopped"           '[[ "$(jget "$F/.swarmforge/operator/tunnel.status.json" ":state")" == stopped ]]'
check "stop kills the process"          '! kill -0 "$PID1" 2>/dev/null'
rm -rf "$F"

# ── 5. authed but auth revoked -> auth_lost, sentinel cleared, no respawn loop ─
F="$(make_fixture)"
# fake CLI that emits the device-login prompt and exits (auth gone)
cat > "$F/.swarmforge/operator/vscode-cli/code" <<'EOF'
#!/usr/bin/env bash
echo "To grant access to the server, please log into https://github.com/login/device and use code ABCD-1234"
EOF
chmod +x "$F/.swarmforge/operator/vscode-cli/code"
touch "$F/.swarmforge/operator/tunnel.authed"
bash "$TUNNEL" ensure "$F" >/dev/null
check "revoked auth -> state auth_lost"  '[[ "$(jget "$F/.swarmforge/operator/tunnel.status.json" ":state")" == auth_lost ]]'
check "sentinel cleared on auth loss"    '[[ ! -f "$F/.swarmforge/operator/tunnel.authed" ]]'
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "operator_tunnel smoke: ALL CHECKS PASSED"
else
  echo "operator_tunnel smoke: FAILURES"; exit 1
fi
