#!/usr/bin/env bash
# Named vs quick mode wiring for launch_resident_spy_tunnel.sh (no live Cloudflare).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCH="$SCRIPT_DIR/../launch_resident_spy_tunnel.sh"
STOP="$SCRIPT_DIR/../stop_ancillary_services.sh"

fail=0
note() { printf '%s\n' "$*"; }
check() {
  if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi
}

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
OP="$ROOT/.swarmforge/operator"
mkdir -p "$OP" "$ROOT/bin"
echo "test-token" > "$OP/bridge-token"

# Fake cloudflared: named mode logs a Registered line (unless
# FAKE_CLOUDFLARED_NEVER_REGISTER is set - named-03); quick mode prints
# trycloudflare URL.
cat > "$ROOT/bin/cloudflared" <<'EOF'
#!/usr/bin/env bash
echo "fake-cloudflared args: $*" >> "$(dirname "$0")/../cf-args.log"
if [[ "$*" == *run* ]]; then
  if [[ -z "${FAKE_CLOUDFLARED_NEVER_REGISTER:-}" ]]; then
    echo "INF Registered tunnel connection connIndex=0" >&2
  fi
  # stay alive briefly so launcher's kill -0 succeeds during wait
  sleep 60 &
  echo $! > "$(dirname "$0")/../cf.pid"
  wait
elif [[ "$*" == *--url* ]]; then
  echo "https://fake-random-name.trycloudflare.com" >&2
  sleep 60 &
  echo $! > "$(dirname "$0")/../cf.pid"
  wait
fi
EOF
# Fake caffeinate: record flags and stay alive (forced via CAFFEINATE= even on Linux CI)
cat > "$ROOT/bin/caffeinate" <<'EOF'
#!/usr/bin/env bash
echo "fake-caffeinate args: $*" >> "$(dirname "$0")/../caffeinate-args.log"
sleep 60 &
echo $! > "$(dirname "$0")/../caffeinate.pid"
wait
EOF
chmod +x "$ROOT/bin/cloudflared" "$ROOT/bin/caffeinate" "$LAUNCH"

# ── named mode ──────────────────────────────────────────────────────────────
mkdir -p "$ROOT/.cloudflared-home"
cat > "$ROOT/.cloudflared-home/config.yml" <<EOF
tunnel: 00000000-0000-0000-0000-000000000001
credentials-file: $ROOT/.cloudflared-home/cred.json
ingress:
  - hostname: bubble.example.com
    service: http://127.0.0.1:8765
  - service: http_status:404
EOF
echo '{}' > "$ROOT/.cloudflared-home/cred.json"
cat > "$OP/named-tunnel.env" <<EOF
SWARMFORGE_NAMED_TUNNEL=swarmforge-bubble
SWARMFORGE_NAMED_TUNNEL_HOSTNAME=bubble.example.com
SWARMFORGE_CLOUDFLARED_CONFIG=$ROOT/.cloudflared-home/config.yml
EOF

OUT="$(
  CLOUDFLARED="$ROOT/bin/cloudflared" \
  CAFFEINATE="$ROOT/bin/caffeinate" \
  HOME="$ROOT" \
  bash "$LAUNCH" "$ROOT" 2>"$ROOT/named.err"
)"
check "named mode prints fixed https URL" '[[ "$OUT" == "https://bubble.example.com" ]]'
check "named mode state json has mode=named" \
  'grep -q "\"mode\": \"named\"" "$OP/resident-spy-tunnel.json"'
check "named mode invoked cloudflared run" \
  'grep -q "run swarmforge-bubble" "$ROOT/cf-args.log"'
check "named mode started caffeinate -dims" \
  'grep -q "\-dims" "$ROOT/caffeinate-args.log"'
check "named mode wrote caffeinate pidfile" \
  '[[ -f "$OP/resident-spy-caffeinate.pid" ]] && kill -0 "$(cat "$OP/resident-spy-caffeinate.pid")" 2>/dev/null'

# stop fake children
if [[ -f "$ROOT/cf.pid" ]]; then kill "$(cat "$ROOT/cf.pid")" 2>/dev/null || true; fi
if [[ -f "$ROOT/caffeinate.pid" ]]; then kill "$(cat "$ROOT/caffeinate.pid")" 2>/dev/null || true; fi
if [[ -f "$OP/resident-spy-caffeinate.pid" ]]; then kill "$(cat "$OP/resident-spy-caffeinate.pid")" 2>/dev/null || true; fi
rm -f "$OP/resident-spy-cloudflared.pid" "$OP/resident-spy-caffeinate.pid" \
  "$ROOT/cf-args.log" "$ROOT/cf.pid" "$ROOT/caffeinate-args.log" "$ROOT/caffeinate.pid"

# ── named-02: named mode with no configured hostname refuses to start ───────
rm -f "$OP/named-tunnel.env" "$OP/resident-spy-tunnel.json"
set +e
OUT_NAMED02="$(
  CLOUDFLARED="$ROOT/bin/cloudflared" \
  CAFFEINATE="$ROOT/bin/caffeinate" \
  SWARMFORGE_NAMED_TUNNEL=swarmforge-bubble \
  SWARMFORGE_SKIP_CAFFEINATE=1 \
  HOME="$ROOT" \
  bash "$LAUNCH" "$ROOT" 2>"$ROOT/named02.err"
)"
STATUS_NAMED02=$?
set -e
check "named-02: no hostname configured exits non-zero" '[[ "$STATUS_NAMED02" -ne 0 ]]'
check "named-02: names the setup script" \
  'grep -q "setup_bubble_named_tunnel.sh" "$ROOT/named02.err"'
check "named-02: no tunnel state file written" '[[ ! -f "$OP/resident-spy-tunnel.json" ]]'
check "named-02: cloudflared never invoked" '[[ ! -f "$ROOT/cf-args.log" ]]'
unset OUT_NAMED02

# ── named-03: a named tunnel that never reaches the edge is not reported up ─
rm -f "$OP/resident-spy-tunnel.json" "$OP/resident-spy-cloudflared.pid"
set +e
OUT_NAMED03="$(
  CLOUDFLARED="$ROOT/bin/cloudflared" \
  CAFFEINATE="$ROOT/bin/caffeinate" \
  SWARMFORGE_NAMED_TUNNEL=swarmforge-bubble \
  SWARMFORGE_NAMED_TUNNEL_HOSTNAME=bubble.example.com \
  SWARMFORGE_CLOUDFLARED_CONFIG="$ROOT/.cloudflared-home/config.yml" \
  SWARMFORGE_SKIP_CAFFEINATE=1 \
  SWARMFORGE_NAMED_TUNNEL_WAIT_ATTEMPTS=3 \
  SWARMFORGE_NAMED_TUNNEL_WAIT_INTERVAL=0 \
  FAKE_CLOUDFLARED_NEVER_REGISTER=1 \
  HOME="$ROOT" \
  bash "$LAUNCH" "$ROOT" 2>"$ROOT/named03.err"
)"
STATUS_NAMED03=$?
set -e
check "named-03: exits non-zero when the edge never registers" '[[ "$STATUS_NAMED03" -ne 0 ]]'
check "named-03: points at the tunnel log" \
  'grep -q "resident-spy-cloudflared.log" "$ROOT/named03.err"'
check "named-03: no tunnel state file written" '[[ ! -f "$OP/resident-spy-tunnel.json" ]]'
check "named-03: process liveness alone was not treated as ready" \
  '! grep -qi "https://bubble.example.com" <<< "$OUT_NAMED03"'
unset OUT_NAMED03

if [[ -f "$ROOT/cf.pid" ]]; then kill "$(cat "$ROOT/cf.pid")" 2>/dev/null || true; fi
rm -f "$OP/resident-spy-cloudflared.pid" "$ROOT/cf-args.log" "$ROOT/cf.pid"

# ── quick mode (no named-tunnel.env) + SKIP caffeinate ──────────────────────
rm -f "$OP/named-tunnel.env"
OUT2="$(
  CLOUDFLARED="$ROOT/bin/cloudflared" \
  CAFFEINATE="$ROOT/bin/caffeinate" \
  SWARMFORGE_SKIP_CAFFEINATE=1 \
  HOME="$ROOT" \
  bash "$LAUNCH" "$ROOT" 2>"$ROOT/quick.err"
)"
check "quick mode prints trycloudflare URL" \
  '[[ "$OUT2" == "https://fake-random-name.trycloudflare.com" ]]'
check "quick mode state json has mode=quick" \
  'grep -q "\"mode\": \"quick\"" "$OP/resident-spy-tunnel.json"'
check "SKIP_CAFFEINATE leaves no pidfile" \
  '[[ ! -f "$OP/resident-spy-caffeinate.pid" ]]'
check "SKIP_CAFFEINATE did not invoke fake binary" \
  '[[ ! -f "$ROOT/caffeinate-args.log" ]]'

if [[ -f "$ROOT/cf.pid" ]]; then kill "$(cat "$ROOT/cf.pid")" 2>/dev/null || true; fi
rm -f "$OP/resident-spy-cloudflared.pid" "$ROOT/cf-args.log" "$ROOT/cf.pid"

# ── keepalive-02: stopping ancillary services tears the keepalive down ──────
sleep 300 & KEEPALIVE_PID=$!
echo "$KEEPALIVE_PID" > "$OP/resident-spy-caffeinate.pid"
set +e
STOP_OUT="$(bash "$STOP" "$ROOT" 2>&1)"
STOP_RC=$?
set -e
check "keepalive-02: stop_ancillary_services.sh exits cleanly" '[[ "$STOP_RC" -eq 0 ]]'
check "keepalive-02: keepalive pidfile is removed" '[[ ! -f "$OP/resident-spy-caffeinate.pid" ]]'
check "keepalive-02: the keepalive process is actually signalled" '! kill -0 "$KEEPALIVE_PID" 2>/dev/null'
kill "$KEEPALIVE_PID" 2>/dev/null || true

if [[ "$fail" -ne 0 ]]; then
  note "named stderr:"; cat "$ROOT/named.err" || true
  note "named-02 stderr:"; cat "$ROOT/named02.err" || true
  note "named-03 stderr:"; cat "$ROOT/named03.err" || true
  note "quick stderr:"; cat "$ROOT/quick.err" || true
  note "stop_ancillary_services output:"; printf '%s\n' "$STOP_OUT" || true
  exit 1
fi
note "PASS: launch_resident_spy_tunnel named vs quick (+ caffeinate, keepalive teardown)"
