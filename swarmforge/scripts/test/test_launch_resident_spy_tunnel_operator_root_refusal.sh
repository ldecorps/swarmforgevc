#!/usr/bin/env bash
# BL-857 sandbox-cannot-bind-production-name-03: a run outside the
# registered operator root cannot bind a named tunnel. Also exercises the
# ownership record's survival across the launching root's own deletion
# (Invariant 2) - a shell-level companion to the JS property test, using
# the REAL launcher end to end with a stubbed cloudflared.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCH="$SCRIPT_DIR/../launch_resident_spy_tunnel.sh"
OWNERSHIP_LIB="$SCRIPT_DIR/../tunnel_ownership_lib.sh"

fail=0
note() { printf '%s\n' "$*"; }
check() {
  if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi
}

write_fake_cloudflared() { # binpath
  cat > "$1" <<'EOF'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$*" == *run* ]]; then
  echo "INF Registered tunnel connection connIndex=0"
  sleep 60 &
  echo $! > "$DIR/cf.pid"
  wait
fi
EOF
  chmod +x "$1"
}

# A registry directory OUTSIDE of any $ROOT this test creates/deletes -
# Invariant 2 ("a tunnel's ownership record outlives the tree that
# launched it") is meaningless if the registry itself lives inside the
# tree being deleted, so this fixture keeps them structurally separate.
REGISTRY_DIR="$(mktemp -d)"
register_tmp_dir "$REGISTRY_DIR"
export SWARMFORGE_TUNNEL_REGISTRY_DIR="$REGISTRY_DIR"

OPERATOR_ROOT="$(mktemp -d)"
register_tmp_dir "$OPERATOR_ROOT"
bash "$OWNERSHIP_LIB" register-operator-root "$OPERATOR_ROOT"

run_named_launch() { # root -> sets RESULT_OUT / RESULT_ERR / RESULT_STATUS
  local root="$1" bin_dir cf_home config
  bin_dir="$root/bin"
  mkdir -p "$bin_dir" "$root/.swarmforge/operator"
  write_fake_cloudflared "$bin_dir/cloudflared"
  cf_home="$root/cloudflared-home"
  mkdir -p "$cf_home"
  config="$cf_home/config.yml"
  cat > "$config" <<EOF
tunnel: 00000000-0000-0000-0000-0000000000aa
credentials-file: $cf_home/cred.json
ingress:
  - hostname: bubble.example.com
    service: http://127.0.0.1:8765
  - service: http_status:404
EOF
  echo '{}' > "$cf_home/cred.json"

  set +e
  RESULT_OUT="$(
    CLOUDFLARED="$bin_dir/cloudflared" \
    SWARMFORGE_NAMED_TUNNEL=swarmforge-bubble \
    SWARMFORGE_NAMED_TUNNEL_HOSTNAME=bubble.example.com \
    SWARMFORGE_CLOUDFLARED_CONFIG="$config" \
    SWARMFORGE_SKIP_CAFFEINATE=1 \
    bash "$LAUNCH" "$root" 2>"$root/err.log"
  )"
  RESULT_STATUS=$?
  set -e
  RESULT_ERR="$(cat "$root/err.log")"
}

# ── sandbox-cannot-bind-production-name-03 ────────────────────────────────
SANDBOX="$(mktemp -d)"
register_tmp_dir "$SANDBOX"
run_named_launch "$SANDBOX"
check "refusal-03: a non-operator root exits non-zero" '[[ "$RESULT_STATUS" -ne 0 ]]'
check "refusal-03: names the operator-root refusal reason" \
  'grep -qi "not the registered operator root" <<< "$RESULT_ERR"'
check "refusal-03: cloudflared is never invoked" '[[ ! -f "$SANDBOX/bin/cf.pid" ]]'
check "refusal-03: no tunnel state file is written" '[[ ! -f "$SANDBOX/.swarmforge/operator/resident-spy-tunnel.json" ]]'
check "refusal-03: no ownership record is written for a refused launch" \
  '[[ -z "$(bash "$OWNERSHIP_LIB" read-owner-pid swarmforge-bubble)" ]]'

# ── the registered operator root itself is still allowed ──────────────────
run_named_launch "$OPERATOR_ROOT"
check "operator root: a launch from the registered root succeeds" '[[ "$RESULT_STATUS" -eq 0 ]]'
check "operator root: prints the fixed hostname URL" '[[ "$RESULT_OUT" == "https://bubble.example.com" ]]'
# The registered/local pidfile pid is the launcher's own top-level
# process (the wrapper nohup'd around cloudflared) - not cf.pid, which the
# fake binary writes for its OWN internal `sleep &` child and is a
# different pid entirely.
LIVE_PID="$(cat "$OPERATOR_ROOT/.swarmforge/operator/resident-spy-cloudflared.pid" 2>/dev/null || true)"
REGISTERED_PID="$(bash "$OWNERSHIP_LIB" read-owner-pid swarmforge-bubble)"
check "operator root: the launch records host-level ownership" '[[ -n "$LIVE_PID" && "$LIVE_PID" == "$REGISTERED_PID" ]]'

# ── Invariant 2: the record outlives the tree that launched it ────────────
check "invariant-2: the tunnel process is alive before deletion" 'kill -0 "$LIVE_PID" 2>/dev/null'
rm -rf "$OPERATOR_ROOT"
check "invariant-2: the launching root is actually gone" '[[ ! -d "$OPERATOR_ROOT" ]]'
check "invariant-2: the ownership record still names the (still-alive) pid after the tree is deleted" \
  '[[ "$(bash "$OWNERSHIP_LIB" read-owner-pid swarmforge-bubble)" == "$LIVE_PID" ]]'
check "invariant-2: the process itself is still running (deleting the tree did not kill it)" \
  'kill -0 "$LIVE_PID" 2>/dev/null'

kill -9 "$LIVE_PID" 2>/dev/null || true

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
note "PASS: launch_resident_spy_tunnel.sh operator-root refusal + ownership record survival (BL-857)"
