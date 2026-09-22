#!/usr/bin/env bash
# BL-1686: drives the REAL functions this ticket fixed - never retyped.
#
# Usage:
#   bl1686FixtureProofBeforeInitCli.sh vanished-tmproot <scratch-cwd>
#     Extracts prove_root+mk_fixture (by source position) from
#     test_bl1378_expedite_close_guard.sh and runs mk_fixture from
#     <scratch-cwd> with TMPROOT pointed at a directory that does not
#     exist - the exact shape a concurrent sweep leaves behind. Prints
#     mk_fixture's own combined output, exits with its status.
#
#   bl1686FixtureProofBeforeInitCli.sh sweep-reaps-dead-only <target-file> <work-dir>
#     Sources the REAL lib/tmp_cleanup.sh and reads the REAL PREFIX
#     constant out of <target-file> (never retyped), builds one root
#     tagged with THIS process's own (live) pid and one tagged with a
#     pid known to be dead (spawned and reaped first), calls the real
#     sweep_stale_prefix_roots, and reports which of the two roots
#     survive.
#
#   bl1686FixtureProofBeforeInitCli.sh census
#     Greps swarmforge/scripts/test/*.sh for the blind BL-971 prefix-sweep
#     idiom this ticket replaced and prints whatever it finds (empty on a
#     fixed tree).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
TEST_DIR="$REPO_ROOT/swarmforge/scripts/test"
BL1378_FILE="$TEST_DIR/test_bl1378_expedite_close_guard.sh"

extract_fn() {
  sed -n "/^$1() {/,/^}/p" "$2"
}

verb="${1:-}"
case "$verb" in
  vanished-tmproot)
    SCRATCH_CWD="${2:?scratch cwd required}"
    GONE_TMPROOT="$(mktemp -d "${TMPDIR:-/tmp}/bl1686-cli-gone.XXXXXX")"
    rm -rf "$GONE_TMPROOT"
    fn_defs="$(extract_fn prove_root "$BL1378_FILE"; extract_fn mk_fixture "$BL1378_FILE")"
    OUT="$(cd "$SCRATCH_CWD" && bash -c "TMPROOT='$GONE_TMPROOT'; TICKET='BL-9001'; $fn_defs; mk_fixture" 2>&1)"
    STATUS=$?
    printf '%s' "$OUT"
    exit "$STATUS"
    ;;
  sweep-reaps-dead-only)
    TARGET="${2:?target file required}"
    WORK="${3:?work dir required}"
    TARGET_PATH="$TEST_DIR/$TARGET"
    [[ -f "$TARGET_PATH" ]] || { echo "no such target: $TARGET_PATH" >&2; exit 2; }
    prefix="$(sed -n 's/^PREFIX="\(.*\)"$/\1/p' "$TARGET_PATH" | head -1)"
    [[ -n "$prefix" ]] || { echo "could not read PREFIX from $TARGET_PATH" >&2; exit 2; }

    # A real, guaranteed-dead pid: spawned and reaped via `wait` before we
    # ever use it, so it is fully gone (not a zombie either) by construction.
    ( : ) &
    dead_pid=$!
    wait "$dead_pid" 2>/dev/null || true

    if [[ "$prefix" == *- ]]; then
      live_root="$WORK/${prefix}$$.abcdef"
      dead_root="$WORK/${prefix}${dead_pid}.abcdef"
    else
      live_root="$WORK/${prefix}.$$.abcdef"
      dead_root="$WORK/${prefix}.${dead_pid}.abcdef"
    fi
    mkdir -p "$live_root" "$dead_root"

    # shellcheck source=/dev/null
    source "$TEST_DIR/lib/tmp_cleanup.sh"
    TMPDIR="$WORK" sweep_stale_prefix_roots "$prefix"

    [[ -d "$live_root" ]] && echo "LIVE_SURVIVED" || echo "LIVE_REMOVED"
    [[ -d "$dead_root" ]] && echo "DEAD_SURVIVED" || echo "DEAD_REMOVED"
    ;;
  census)
    grep -ln 'rm -rf "${TMPDIR:-/tmp}/${PREFIX}"' "$TEST_DIR"/*.sh || true
    ;;
  *)
    echo "usage: bl1686FixtureProofBeforeInitCli.sh vanished-tmproot <scratch-cwd> | sweep-reaps-dead-only <target-file> <work-dir> | census" >&2
    exit 2
    ;;
esac
