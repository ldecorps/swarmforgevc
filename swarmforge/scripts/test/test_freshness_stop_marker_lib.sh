#!/usr/bin/env bash
# BL-785: unit tests for freshness_stop_marker_lib.sh — the durable
# per-daemon "stopped on purpose" record shared by the stop paths, the start
# paths, and the BL-675 freshness checker. File-existence only; no live
# process is ever consulted.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
LIB="$SRC/freshness_stop_marker_lib.sh"

fail=0
note() { printf '%s\n' "$*"; }
check() {
  if eval "$2"; then
    note "ok   - $1"
  else
    note "FAIL - $1"
    fail=1
  fi
}
pass() { note "PASS: $*"; }

make_root() {
  local d
  d="$(mktemp -d)"
  register_tmp_dir "$d"
  printf '%s' "$d"
}

# shellcheck disable=SC1090
source "$LIB"

# ── 01: a daemon with no marker is not deliberately stopped ───────────────
ROOT="$(make_root)"
check "01: unstopped daemon reads as not-stopped" \
  '! freshness_is_stopped "$ROOT" "handoffd"'
pass "01: absent marker means not deliberately stopped"

# ── 02: marking writes a durable, file-only record ─────────────────────────
ROOT="$(make_root)"
freshness_mark_stopped "$ROOT" "handoffd"
check "02: marked daemon reads as stopped" \
  'freshness_is_stopped "$ROOT" "handoffd"'
check "02: marker is a plain file under freshness-stopped/" \
  '[[ -f "$ROOT/.swarmforge/daemon/freshness-stopped/handoffd.stopped" ]]'
pass "02: freshness_mark_stopped writes a durable marker"

# ── 03: per-daemon scoping — marking one daemon never marks another ────────
ROOT="$(make_root)"
freshness_mark_stopped "$ROOT" "handoffd"
check "03: unmarked sibling daemon still reads as not-stopped" \
  '! freshness_is_stopped "$ROOT" "babysitterd"'
pass "03: marker scoping is per-daemon, not global"

# ── 04: clearing re-arms — marker absent afterward ──────────────────────────
ROOT="$(make_root)"
freshness_mark_stopped "$ROOT" "handoffd"
freshness_clear_stopped "$ROOT" "handoffd"
check "04: cleared daemon reads as not-stopped" \
  '! freshness_is_stopped "$ROOT" "handoffd"'
check "04: marker file is gone" \
  '[[ ! -f "$ROOT/.swarmforge/daemon/freshness-stopped/handoffd.stopped" ]]'
pass "04: freshness_clear_stopped re-arms watching"

# ── 05: idempotent mark — marking twice leaves the same stopped state ──────
ROOT="$(make_root)"
freshness_mark_stopped "$ROOT" "handoffd"
freshness_mark_stopped "$ROOT" "handoffd"
check "05: still stopped after a second mark" \
  'freshness_is_stopped "$ROOT" "handoffd"'
pass "05: marking twice in a row is idempotent"

# ── 06: idempotent clear — clearing when already absent is a no-op ─────────
ROOT="$(make_root)"
freshness_clear_stopped "$ROOT" "handoffd"
check "06: clearing an unmarked daemon does not error or mark it stopped" \
  '! freshness_is_stopped "$ROOT" "handoffd"'
pass "06: clearing an absent marker is a safe no-op"

# ── 07: readable with no live process — a plain file check, nothing else ───
# freshness_is_stopped must never shell out to ps/pgrep/kill/curl/nc to ask
# whether a daemon or supervisor is alive (BL-675 share-no-fate: the verdict
# must hold with every bb/node/swarm process dead). Static check on the
# actual function body, not a behavioural proxy — a process-query dependency
# here would be invisible to scenarios 01-06, which all run with the test's
# own shell alive.
FN_BODY="$(awk '/^freshness_is_stopped\(\)/{p=1} p{print} p&&/^}/{exit}' "$LIB")"
check "07: verdict body contains no process-query commands" \
  '! grep -qE "\b(ps|pgrep|pkill|kill|curl|nc)\b" <<< "$FN_BODY"'
check "07: verdict body is a plain [ -f ] test" \
  'grep -qE "\[ -f " <<< "$FN_BODY"'
pass "07: deliberate-stop verdict never asks a live process"

if [[ "$fail" -eq 0 ]]; then
  echo "BL-785 freshness_stop_marker_lib: ALL CHECKS PASSED"
else
  echo "BL-785 freshness_stop_marker_lib: FAILURES"
  exit 1
fi
