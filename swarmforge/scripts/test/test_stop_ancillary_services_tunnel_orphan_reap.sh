#!/usr/bin/env bash
# BL-857: end-to-end orphan reaping through the REAL stop_ancillary_services.sh
# (never a mocked signal_pid_file or a fabricated process list here - the
# unit-level decision logic already has its own test in
# test_tunnel_ownership_lib.sh). Fake cloudflared-shaped processes are real,
# harmless, self-spawned sleeps (this file's own fixtures, killed at the end
# even on failure) - "fixtures must not kill real processes" from the
# ticket's constraints, not "fixtures must not use real processes".
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STOP="$SCRIPT_DIR/../stop_ancillary_services.sh"
OWNERSHIP_LIB="$SCRIPT_DIR/../tunnel_ownership_lib.sh"
# Deliberately NOT the real production name ("swarmforge-bubble") - this
# fixture's whole point is exercising real pgrep/kill against real (if
# harmless) processes, and a dev/CI host may well have the REAL operator
# tunnel running under that exact name at the same time. Reusing it here
# would be this ticket's own incident, self-inflicted by its test.
NAME="bl857-orphan-reap-test-tunnel-$$"

fail=0
note() { printf '%s\n' "$*"; }
check() {
  if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi
}
alive() { kill -0 "$1" 2>/dev/null; }

SPAWNED_PIDS=()
# Spawns a background process whose full command line contains
# "run <name>" the same way a real cloudflared invocation would, without
# needing a fake binary on disk - `-a` sets argv[0] but bash's own extra
# words are not visible via ps, so a real fake binary is used instead (bash
# on macOS does not support the `-c` word-splitting trick portably for a
# custom argv[0] with extra trailing tokens).
spawn_fake_cloudflared() { # name -> echoes pid
  local dir bin pid
  dir="$(mktemp -d)"
  register_tmp_dir "$dir"
  bin="$dir/cloudflared"
  cat > "$bin" <<'EOF'
#!/usr/bin/env bash
sleep 300
EOF
  chmod +x "$bin"
  # Redirected: this function is always called as `x="$(spawn_fake_cloudflared ...)"`
  # - without this, the backgrounded process inherits the command
  # substitution's own stdout pipe and keeps its write end open for its
  # whole 300s sleep, so the substitution never sees EOF and hangs.
  "$bin" tunnel --config "$dir/fake-config.yml" --no-autoupdate run "$1" >/dev/null 2>&1 &
  pid=$!
  SPAWNED_PIDS+=("$pid")
  printf '%s\n' "$pid"
}

cleanup_spawned() {
  local p
  for p in ${SPAWNED_PIDS[@]+"${SPAWNED_PIDS[@]}"}; do
    kill -9 "$p" 2>/dev/null || true
  done
}
trap cleanup_spawned EXIT

# A distinct "operator" fixture root, with named-tunnel.env present - this
# is what lets stop_ancillary_services.sh resolve which tunnel name to
# scope reaping to, exactly like the real operator's own root would.
OPERATOR_ROOT="$(mktemp -d)"
register_tmp_dir "$OPERATOR_ROOT"
OP_DIR="$OPERATOR_ROOT/.swarmforge/operator"
mkdir -p "$OP_DIR"
cat > "$OP_DIR/named-tunnel.env" <<EOF
SWARMFORGE_NAMED_TUNNEL=$NAME
SWARMFORGE_NAMED_TUNNEL_HOSTNAME=bubble.example.com
SWARMFORGE_CLOUDFLARED_CONFIG=$OPERATOR_ROOT/config.yml
EOF

# Isolates the host-level registry to this fixture for the whole test -
# every direct call to the ownership lib below AND every call
# stop_ancillary_services.sh itself makes internally must agree on this
# same directory, never the real developer $HOME.
REGISTRY_DIR="$OPERATOR_ROOT/.swarmforge/tunnels"
export SWARMFORGE_TUNNEL_REGISTRY_DIR="$REGISTRY_DIR"

run_stop() {
  bash "$STOP" "$OPERATOR_ROOT"
}

# ── BL-857 orphan-reaped-01 ──────────────────────────────────────────────
# A tunnel bound to the production name whose launching tree has been
# deleted: no local pidfile can name it (the tree is gone), no registry
# entry protects it either. It must still be reaped.
SANDBOX="$(mktemp -d)"
ORPHAN_PID="$(spawn_fake_cloudflared "$NAME")"
sleep 0.3
check "orphan-reaped-01: the orphan starts out alive" 'alive "$ORPHAN_PID"'
rm -rf "$SANDBOX"

run_stop
check "orphan-reaped-01: the stop path reaps a tunnel whose launching tree is gone" \
  '! alive "$ORPHAN_PID"'

# ── BL-857 operator-instance-survives-02 ─────────────────────────────────
# The operator's own currently-registered instance must never be mistaken
# for an orphan, even while a genuine orphan (tree deleted) exists
# alongside it.
OPERATOR_PID="$(spawn_fake_cloudflared "$NAME")"
sleep 0.3
bash "$OWNERSHIP_LIB" record-owner "$NAME" "$OPERATOR_PID" "$OPERATOR_ROOT"

SANDBOX2="$(mktemp -d)"
ORPHAN_PID2="$(spawn_fake_cloudflared "$NAME")"
sleep 0.3
rm -rf "$SANDBOX2"

run_stop
check "operator-instance-survives-02: the operator instance is still running" \
  'alive "$OPERATOR_PID"'
check "operator-instance-survives-02: the orphan alongside it is still reaped" \
  '! alive "$ORPHAN_PID2"'
kill -9 "$OPERATOR_PID" 2>/dev/null || true
bash "$OWNERSHIP_LIB" clear-owner "$NAME"

# ── BL-857 stale-ownership-record-05 ─────────────────────────────────────
# A registry record whose pid has already exited must not be treated as a
# live owner. Tested the way that actually distinguishes "correctly
# excluded" from "any record at all blanket-protects the name": a genuine
# orphan for the SAME name is present alongside the stale record, and must
# still be reaped - if a regression made "a record exists" alone suppress
# reaping (rather than checking the specific pid), this is what would catch
# it. (This root's OWN local pidfile is deliberately untouched here - that
# path is unconditionally stopped by this script's pre-existing,
# unrelated-to-BL-857 stop-swarm behavior regardless of any registry state,
# so it cannot be what "still running" means for a stale *registry* record;
# operator-instance-survives-02 above already covers registry-based
# protection of a live instance.)
DEAD_PID="$(spawn_fake_cloudflared "$NAME")"
kill -9 "$DEAD_PID" 2>/dev/null || true
wait "$DEAD_PID" 2>/dev/null || true
for _ in $(seq 1 50); do kill -9 "$DEAD_PID" 2>/dev/null || true; alive "$DEAD_PID" || break; sleep 0.1; done
check "stale-ownership-record-05: the fixture pid is confirmed dead before use" '! alive "$DEAD_PID"'
bash "$OWNERSHIP_LIB" record-owner "$NAME" "$DEAD_PID" "$OPERATOR_ROOT"

SANDBOX3="$(mktemp -d)"
ORPHAN_PID3="$(spawn_fake_cloudflared "$NAME")"
sleep 0.3
rm -rf "$SANDBOX3"

run_stop
check "stale-ownership-record-05: the record is not treated as a live owner (the orphan is still reaped)" \
  '! alive "$ORPHAN_PID3"'
READ_BACK="$(bash "$OWNERSHIP_LIB" read-owner-pid "$NAME")"
check "stale-ownership-record-05: the stale record itself is left as-is (not silently fixed up)" \
  '[[ "$READ_BACK" == "$DEAD_PID" ]]'
bash "$OWNERSHIP_LIB" clear-owner "$NAME"

# ── BL-857 reap-is-name-scoped-06 ────────────────────────────────────────
# A cloudflared serving a different name entirely is left alone, even
# though the stop path's reap runs unconditionally.
OTHER_NAME="some-unrelated-tunnel"
OTHER_PID="$(spawn_fake_cloudflared "$OTHER_NAME")"
sleep 0.3
check "reap-is-name-scoped-06: the other-name tunnel starts out alive" 'alive "$OTHER_PID"'

run_stop
check "reap-is-name-scoped-06: a tunnel serving a different name is still running" \
  'alive "$OTHER_PID"'
kill -9 "$OTHER_PID" 2>/dev/null || true

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
note "PASS: stop_ancillary_services.sh tunnel orphan reap (BL-857 scenarios 01/02/05/06)"
