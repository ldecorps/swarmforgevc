#!/usr/bin/env bash
# BL-367 hardening: project_socket_id_lib.sh's project_socket_id had zero
# direct test coverage despite being the shared implementation both
# swarmforge.sh (where the socket is CREATED) and kill_all_swarm.sh (where
# the legacy /tmp path is LOOKED UP) rely on staying byte-identical - the
# lib's own header comment names exactly this drift risk. A test only
# exercising it indirectly through one of the two callers would not prove
# the two callers actually agree with each other.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../project_socket_id_lib.sh"

failures=0
fail() { echo "FAIL: $*" >&2; failures=$((failures + 1)); }
pass() { echo "PASS: $*"; }

# Deterministic: the same input always produces the same id.
ID_1="$(project_socket_id "/home/pi/swarmforgevc")"
ID_2="$(project_socket_id "/home/pi/swarmforgevc")"
[[ "$ID_1" == "$ID_2" ]] || fail "project_socket_id is not deterministic for the same input: $ID_1 vs $ID_2"
pass "project_socket_id is deterministic for the same input"

# Different inputs produce different ids (the whole point: one id per project).
ID_A="$(project_socket_id "/home/pi/swarmforgevc")"
ID_B="$(project_socket_id "/home/pi/some-other-project")"
[[ "$ID_A" != "$ID_B" ]] || fail "project_socket_id collided for two different working dirs: $ID_A"
pass "project_socket_id produces distinct ids for distinct working dirs"

# The output is exactly the numeric cksum field, never the byte-count field
# cksum also prints (a naive `cksum` parse could accidentally keep both,
# which would silently break the .sock filename downstream) and never
# embeds whitespace (would break both `$dir/$id.sock` construction and the
# shell glob that later looks for that file).
[[ "$ID_1" =~ ^[0-9]+$ ]] || fail "project_socket_id emitted something other than a bare numeric id: '$ID_1'"
pass "project_socket_id emits a bare numeric id (no byte-count suffix, no whitespace)"

# It must match cksum's own first field exactly - proves the wrapper is
# extracting the right piece, not e.g. the byte count or a truncated value.
EXPECTED="$(printf '%s' "/home/pi/swarmforgevc" | cksum)"
EXPECTED="${EXPECTED%% *}"
[[ "$ID_1" == "$EXPECTED" ]] || fail "project_socket_id ($ID_1) does not match cksum's own first field ($EXPECTED)"
pass "project_socket_id matches cksum's own first (checksum) field, not the byte count"

if [[ "$failures" -gt 0 ]]; then
  echo "test_project_socket_id_lib.sh: $failures FAILURE(S)"
  exit 1
fi
echo "ALL PASS"
