#!/usr/bin/env bash
# BL-367: the swarm's tmux control socket must never live in /tmp - the one
# directory on the box everybody treats as shared scratch space and which
# gets reaped (systemd-tmpfiles, cleanup scripts, a human's `rm -rf /tmp/*`).
# A unix socket cannot be re-linked once unlinked and tmux cannot rebind a
# running server to a new path, so a socket deleted out from under a live
# server is UNRECOVERABLE. The pure resolve-socket-path decision itself is
# unit-tested in swarm_socket_lib_test_runner.bb; this file proves the real
# CLI wrapper swarmforge.sh actually shells out to, and that kill_all_swarm.sh
# still finds and kills a socket at the NEW location.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOLVE="$SCRIPT_DIR/../resolve_swarm_socket.bb"
KILL_ALL="$SCRIPT_DIR/../kill_all_swarm.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# Rooted under $HOME, deliberately NOT /tmp: this test asserts the resolved
# socket path is never /tmp - a fixture that itself lived under /tmp would
# confound that assertion (the project root would start with /tmp for a
# reason unrelated to this ticket's fix).
FIXTURE_BASE="$HOME/.sfvc-test-bl367"
mkdir -p "$FIXTURE_BASE"
ROOT="$(cd "$(mktemp -d "$FIXTURE_BASE/root.XXXXXXXX")" && pwd -P)"
trap 'rm -rf "$ROOT" "$FIXTURE_BASE"' EXIT

# ═══════════════════════════════════════════════════════════════════════════
# Scenario 01: the control socket does not live in shared scratch space
# ═══════════════════════════════════════════════════════════════════════════

SOCK="$(env -u XDG_RUNTIME_DIR bb "$RESOLVE" "$ROOT" 12345 2>&1)" \
  || fail "01: resolve_swarm_socket.bb failed for a normal-length path; got: $SOCK"
[[ "$SOCK" == "$ROOT/.swarmforge/tmux/12345.sock" ]] \
  || fail "01: expected the resolved socket under .swarmforge/tmux/; got: $SOCK"
[[ "$SOCK" != /tmp/* ]] || fail "01: the resolved socket must never live in /tmp"
pass "01: a normal project root resolves its control socket into its own .swarmforge/ tree, never /tmp"

# ═══════════════════════════════════════════════════════════════════════════
# Scenario 03: the swarm launches on a host that offers no per-user runtime
#              directory (XDG_RUNTIME_DIR unset) - the primary path still
#              works, since it does not depend on XDG_RUNTIME_DIR at all
# ═══════════════════════════════════════════════════════════════════════════

SOCK="$(env -u XDG_RUNTIME_DIR bb "$RESOLVE" "$ROOT" 12345 2>&1)" \
  || fail "03: resolve_swarm_socket.bb failed with XDG_RUNTIME_DIR unset; got: $SOCK"
[[ "$SOCK" == "$ROOT/.swarmforge/tmux/12345.sock" ]] \
  || fail "03: expected the primary .swarmforge/ path even with no XDG_RUNTIME_DIR; got: $SOCK"
[[ "$SOCK" != /tmp/* ]] || fail "03: must never fall back to /tmp when XDG_RUNTIME_DIR is unset"
pass "03: the swarm still resolves a private control-socket path with no XDG_RUNTIME_DIR, and never falls back to /tmp"

# ═══════════════════════════════════════════════════════════════════════════
# Scenario 04: a deeply-nested project still gets a usable socket (or a
#              clear, named diagnostic - never an opaque errno)
# ═══════════════════════════════════════════════════════════════════════════

DEEP_ROOT="$ROOT/$(printf 'a%.0s' $(seq 1 90))"
mkdir -p "$DEEP_ROOT"

SOCK="$(XDG_RUNTIME_DIR=/run/user/1000 bb "$RESOLVE" "$DEEP_ROOT" 12345 2>&1)" \
  || fail "04: expected the XDG_RUNTIME_DIR fallback to succeed for a deep project root; got: $SOCK"
[[ "$SOCK" == "/run/user/1000/swarmforge/12345.sock" ]] \
  || fail "04: expected the fallback under XDG_RUNTIME_DIR; got: $SOCK"
pass "04a: a deeply-nested project falls back to a short XDG_RUNTIME_DIR socket path rather than overrunning the OS limit"

set +e
ERR="$(env -u XDG_RUNTIME_DIR bb "$RESOLVE" "$DEEP_ROOT" 12345 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "04: expected a non-zero exit when the deep path overruns the limit with no XDG_RUNTIME_DIR fallback; got: $ERR"
echo "$ERR" | grep -qi "unix-socket path limit" \
  || fail "04: expected a CLEAR diagnostic naming the unix-socket path limit, never an opaque errno; got: $ERR"
pass "04b: with no usable fallback, a deep project root fails loudly naming the OS socket-path limit - never a blind bind or an opaque errno"

# ═══════════════════════════════════════════════════════════════════════════
# kill_all_swarm.sh must still find and kill a socket at the NEW location
# (not just the legacy /tmp/swarmforge-*/*.sock glob)
# ═══════════════════════════════════════════════════════════════════════════

SWARM_ROOT="$(cd "$(mktemp -d "$FIXTURE_BASE/swarm.XXXXXXXX")" && pwd -P)"
mkdir -p "$SWARM_ROOT/.swarmforge/tmux" "$SWARM_ROOT/.swarmforge/daemon"

FAKE_TMUX_SOCK="$SWARM_ROOT/.swarmforge/tmux/12345.sock"
# A real bound AF_UNIX socket, not just a placeholder inode - kill_all_swarm.sh's
# kill_tmux_socket only acts on it if `[[ -S "$sock" ]]`, a real socket-type
# check. Backgrounded and left bound (not accepted/closed) so the socket
# FILE stays present for this test's own glob-matching assertion; this test
# proves kill_all_swarm.sh's own SOCKET_GLOB finds a socket at the NEW
# location, not that a real tmux server death is observable (test_handoffd_*
# files already exercise real tmux teardown elsewhere).
bb -e "
(import '[java.net UnixDomainSocketAddress StandardProtocolFamily] '[java.nio.channels ServerSocketChannel])
(def ch (ServerSocketChannel/open StandardProtocolFamily/UNIX))
(.bind ch (UnixDomainSocketAddress/of (java.nio.file.Path/of \"$FAKE_TMUX_SOCK\" (make-array String 0))))
(Thread/sleep 30000)
" &
SOCKET_HOLDER_PID=$!
for _ in $(seq 1 20); do
  [[ -S "$FAKE_TMUX_SOCK" ]] && break
  sleep 0.1
done
[[ -S "$FAKE_TMUX_SOCK" ]] || { kill -9 "$SOCKET_HOLDER_PID" 2>/dev/null || true; fail "kill_all_swarm setup: fake unix socket was never created at the new location"; }

bash "$KILL_ALL" "$SWARM_ROOT" >/dev/null 2>&1 || true

# The fake socket is not a real tmux server, so `tmux -S ... kill-server`
# against it fails and leaves the file in place - this test proves the
# GLOB matched it and an attempt was logged, which is the actual behavior
# under test (real tmux teardown is already covered by test_handoffd_*).
grep -q "$FAKE_TMUX_SOCK" "$SWARM_ROOT/.swarmforge/daemon/kill-all-audit.log" \
  || fail "expected kill_all_swarm.sh to log an attempt against the new-location socket; got: $(cat "$SWARM_ROOT/.swarmforge/daemon/kill-all-audit.log" 2>/dev/null)"
pass "kill_all_swarm.sh's socket glob follows the new .swarmforge/tmux/ location, not just the legacy /tmp one"

kill -9 "$SOCKET_HOLDER_PID" 2>/dev/null || true
rm -rf "$SWARM_ROOT"

# ═══════════════════════════════════════════════════════════════════════════
# kill_all_swarm.sh's legacy /tmp lookup must be a SINGLE EXACT match on this
# root's own project_socket_id, never a broad glob that could touch another
# project's socket sharing this uid's legacy directory. This is the literal
# defect that matched and killed the LIVE swarm's real socket 5 times in one
# session before BL-367 (see this ticket's notes) - the regression this test
# exists to close.
#
# Exercised via SWARMFORGE_LEGACY_SOCKET_DIR, a test-only override matching
# swarmforge.sh's own SWARMFORGE_CONFIG convention, so this scenario NEVER
# creates or touches a file under the real, live /tmp/swarmforge-${UID}/
# this very swarm's own control socket may sit in.
# ═══════════════════════════════════════════════════════════════════════════

LEGACY_DIR="$(mktemp -d "$FIXTURE_BASE/legacy.XXXXXXXX")"
ROOT_A="$(cd "$(mktemp -d "$FIXTURE_BASE/proj-a.XXXXXXXX")" && pwd -P)"
ROOT_B="$(cd "$(mktemp -d "$FIXTURE_BASE/proj-b.XXXXXXXX")" && pwd -P)"
mkdir -p "$ROOT_A/.swarmforge/daemon"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/../project_socket_id_lib.sh"
ID_A="$(project_socket_id "$ROOT_A")"
ID_B="$(project_socket_id "$ROOT_B")"
[[ "$ID_A" != "$ID_B" ]] \
  || fail "legacy-scoping setup: two distinct fixture roots produced the same project_socket_id ($ID_A) - test fixture is broken, not the code under test"

LEGACY_SOCK_A="$LEGACY_DIR/$ID_A.sock"
LEGACY_SOCK_B="$LEGACY_DIR/$ID_B.sock"

bind_fake_socket() {
  local sock="$1"
  bb -e "
(import '[java.net UnixDomainSocketAddress StandardProtocolFamily] '[java.nio.channels ServerSocketChannel])
(def ch (ServerSocketChannel/open StandardProtocolFamily/UNIX))
(.bind ch (UnixDomainSocketAddress/of (java.nio.file.Path/of \"$sock\" (make-array String 0))))
(Thread/sleep 30000)
" &
  echo $!
}

PID_A="$(bind_fake_socket "$LEGACY_SOCK_A")"
PID_B="$(bind_fake_socket "$LEGACY_SOCK_B")"
for _ in $(seq 1 20); do
  [[ -S "$LEGACY_SOCK_A" && -S "$LEGACY_SOCK_B" ]] && break
  sleep 0.1
done
[[ -S "$LEGACY_SOCK_A" && -S "$LEGACY_SOCK_B" ]] \
  || { kill -9 "$PID_A" "$PID_B" 2>/dev/null || true; fail "legacy-scoping setup: fake legacy sockets were never created"; }

SWARMFORGE_LEGACY_SOCKET_DIR="$LEGACY_DIR" bash "$KILL_ALL" "$ROOT_A" >/dev/null 2>&1 || true

AUDIT_A="$ROOT_A/.swarmforge/daemon/kill-all-audit.log"
grep -q "$LEGACY_SOCK_A" "$AUDIT_A" \
  || fail "expected kill_all_swarm.sh (run against ROOT_A) to attempt ROOT_A's own legacy socket; got: $(cat "$AUDIT_A" 2>/dev/null)"
if grep -q "$LEGACY_SOCK_B" "$AUDIT_A"; then
  fail "kill_all_swarm.sh (run against ROOT_A) touched ROOT_B's DIFFERENT legacy socket - exact-match scoping regressed to a broad glob"
fi
pass "kill_all_swarm.sh's legacy /tmp lookup is a single exact match on this root's own project_socket_id, never a different project's socket sharing the same legacy directory"

kill -9 "$PID_A" "$PID_B" 2>/dev/null || true
rm -rf "$LEGACY_DIR" "$ROOT_A" "$ROOT_B"

echo "ALL PASS"
