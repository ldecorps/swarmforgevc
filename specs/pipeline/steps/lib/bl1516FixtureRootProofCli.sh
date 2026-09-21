#!/usr/bin/env bash
# BL-1516: drives test_bl1378_expedite_close_guard.sh's OWN prove_root/
# mk_fixture/unlanded_commit function bodies - extracted by source position,
# never retyped - against a caller-chosen TMPROOT, so the acceptance
# scenarios exercise the real guard without running the whole (much larger)
# guard suite or touching the live checkout.
#
# Usage:
#   bl1516FixtureRootProofCli.sh good-root <tmproot>
#     mk_fixture under <tmproot>; prints the fixture root, exit 0.
#   bl1516FixtureRootProofCli.sh bad-root <tmproot> <outside-root>
#     prove_root against <outside-root> (already a real git repo, NOT under
#     <tmproot>); prints prove_root's own stderr, exits with its status.
#   bl1516FixtureRootProofCli.sh unlanded-commit <tmproot> <root>
#     unlanded_commit against <root> (already mk_fixture'd under <tmproot>);
#     prints the resulting sha.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/../../../../swarmforge/scripts/test/test_bl1378_expedite_close_guard.sh"

# Extracts one function's definition, by its own `name() {` .. `}` markers -
# the source's own text, never a re-typed copy.
extract_fn() {
  sed -n "/^$1() {/,/^}/p" "$TARGET"
}

verb="${1:-}"
case "$verb" in
  good-root)
    TMPROOT="${2:?tmproot required}"
    TICKET="BL-9001"
    fn_defs="$(extract_fn prove_root; extract_fn mk_fixture)"
    bash -c "TMPROOT='$TMPROOT'; TICKET='$TICKET'; $fn_defs; mk_fixture"
    exit $?
    ;;
  bad-root)
    TMPROOT="${2:?tmproot required}"
    OUTSIDE="${3:?outside root required}"
    fn_defs="$(extract_fn prove_root)"
    bash -c "TMPROOT='$TMPROOT'; $fn_defs; prove_root '$OUTSIDE'" 2>&1
    exit $?
    ;;
  unlanded-commit)
    TMPROOT="${2:?tmproot required}"
    ROOT="${3:?root required}"
    fn_defs="$(extract_fn prove_root; extract_fn unlanded_commit)"
    bash -c "TMPROOT='$TMPROOT'; $fn_defs; unlanded_commit '$ROOT'"
    exit $?
    ;;
  *)
    echo "usage: bl1516FixtureRootProofCli.sh good-root|bad-root|unlanded-commit <tmproot> [<root>]" >&2
    exit 2
    ;;
esac
