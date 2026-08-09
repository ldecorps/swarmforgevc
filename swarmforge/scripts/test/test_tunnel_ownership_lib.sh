#!/usr/bin/env bash
# BL-857: unit coverage for tunnel_ownership_lib.sh's registry read/write
# semantics and its pure orphan-decision function. Never spawns or kills a
# real process here (that's the reap-orphans integration test's job) - the
# decision function is fed fabricated "<pid> <cmdline>" lines exactly like
# the ticket's "process list and the kill as injected edges" constraint
# asks for, so a regression in the decision logic fails without depending
# on real pgrep/kill behavior.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/../tunnel_ownership_lib.sh"

fail=0
note() { printf '%s\n' "$*"; }
check() {
  if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi
}

REGISTRY="$(mktemp -d)"
register_tmp_dir "$REGISTRY"
export SWARMFORGE_TUNNEL_REGISTRY_DIR="$REGISTRY"

# ── operator-root: write-once ────────────────────────────────────────────
ROOT_A="$(mktemp -d)"; register_tmp_dir "$ROOT_A"
ROOT_B="$(mktemp -d)"; register_tmp_dir "$ROOT_B"

bash "$LIB" register-operator-root "$ROOT_A"
bash "$LIB" register-operator-root "$ROOT_B"
RECORDED="$(bash "$LIB" read-operator-root)"
check "operator-root: first registration wins" '[[ "$RECORDED" == "$(cd "$ROOT_A" && pwd)" ]]'
check "operator-root: root A is recognized as the operator root" \
  'bash "$LIB" is-operator-root "$ROOT_A"'
check "operator-root: root B is refused (never silently re-appointed)" \
  '! bash "$LIB" is-operator-root "$ROOT_B"'
check "operator-root: an unrelated fresh root is refused too" \
  '! bash "$LIB" is-operator-root "$(mktemp -d)"'

# ── operator-root: survives the registered root's own deletion ──────────
ROOT_C="$(mktemp -d)"
bash "$LIB" register-operator-root "$ROOT_A"  # already recorded; no-op, sanity
DELETABLE_REGISTRY="$(mktemp -d)"; register_tmp_dir "$DELETABLE_REGISTRY"
GONE_ROOT="$(mktemp -d)"
SWARMFORGE_TUNNEL_REGISTRY_DIR="$DELETABLE_REGISTRY" bash "$LIB" register-operator-root "$GONE_ROOT"
GONE_ROOT_ABS="$(cd "$GONE_ROOT" && pwd)"
rm -rf "$GONE_ROOT"
check "operator-root: comparison still works after the recorded root is deleted" \
  'SWARMFORGE_TUNNEL_REGISTRY_DIR="$DELETABLE_REGISTRY" bash "$LIB" is-operator-root "$GONE_ROOT_ABS"'
rm -rf "$ROOT_C"

# ── owner record round-trip ──────────────────────────────────────────────
bash "$LIB" record-owner swarmforge-bubble 12345 "$ROOT_A"
OWNER_PID="$(bash "$LIB" read-owner-pid swarmforge-bubble)"
check "owner: records and reads back the pid" '[[ "$OWNER_PID" == "12345" ]]'
bash "$LIB" record-owner swarmforge-bubble 67890 "$ROOT_A"
OWNER_PID2="$(bash "$LIB" read-owner-pid swarmforge-bubble)"
check "owner: a fresh launch overwrites the previous owner" '[[ "$OWNER_PID2" == "67890" ]]'
bash "$LIB" clear-owner swarmforge-bubble
OWNER_PID3="$(bash "$LIB" read-owner-pid swarmforge-bubble)"
check "owner: clear-owner removes the record" '[[ -z "$OWNER_PID3" ]]'
check "owner: reading a name that was never recorded returns empty" \
  '[[ -z "$(bash "$LIB" read-owner-pid never-registered-name)" ]]'

# ── decide-orphans: pure logic, no real processes ────────────────────────
decide() {
  # $1=name, $2=protected pids (space-separated, may be empty), stdin=candidates
  bash "$LIB" decide-orphans "$1" $2
}

RESULT="$(printf '100 /bin/cloudflared tunnel --config x --no-autoupdate run swarmforge-bubble\n' | decide swarmforge-bubble "")"
check "decide: a single unprotected match is an orphan" '[[ "$RESULT" == "100" ]]'

RESULT="$(printf '100 /bin/cloudflared tunnel --config x --no-autoupdate run swarmforge-bubble\n' | decide swarmforge-bubble "100")"
check "decide: the protected pid is never listed as an orphan" '[[ -z "$RESULT" ]]'

RESULT="$(printf '100 /bin/cloudflared tunnel run swarmforge-bubble\n200 /bin/cloudflared tunnel run swarmforge-bubble-staging\n300 /bin/cloudflared tunnel run old-swarmforge-bubble\n' | decide swarmforge-bubble "")"
check "decide: a name that is merely a substring of another name never matches (suffix)" \
  '[[ "$(printf "%s\n" "$RESULT" | grep -c "^200$")" == "0" ]]'
check "decide: a name that is merely a substring of another name never matches (prefix)" \
  '[[ "$(printf "%s\n" "$RESULT" | grep -c "^300$")" == "0" ]]'
check "decide: the exact-name match is still found among the noise" \
  '[[ "$(printf "%s\n" "$RESULT" | grep -c "^100$")" == "1" ]]'

RESULT="$(printf '100 /bin/cloudflared tunnel --config x run swarmforge-bubble\n200 /bin/cloudflared tunnel --config y run swarmforge-bubble\n300 /bin/cloudflared tunnel --config z run swarmforge-bubble\n' | decide swarmforge-bubble "300")"
check "decide: every unprotected match among several is reaped" \
  '[[ "$(printf "%s\n" "$RESULT" | sort | tr "\n" " ")" == "100 200 " ]]'

RESULT="$(printf '100 /bin/cloudflared tunnel run some-other-tunnel\n' | decide swarmforge-bubble "")"
check "decide: a process serving a different name entirely is never touched" '[[ -z "$RESULT" ]]'

RESULT="$(printf '100 /bin/notcloudflared some args with run swarmforge-bubble embedded\n' | decide swarmforge-bubble "")"
check "decide: still matches on the run+name token pair regardless of binary name" '[[ "$RESULT" == "100" ]]'

RESULT="$(printf '' | decide swarmforge-bubble "")"
check "decide: no candidates at all yields no orphans" '[[ -z "$RESULT" ]]'

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
note "PASS: tunnel_ownership_lib registry + orphan-decision logic"
