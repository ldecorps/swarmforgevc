#!/usr/bin/env bash
# BL-1728: drives test_operator_runtime_babysitterd_watchdog.sh's OWN
# prove_git_fixture_root/init_git_fixture_root function bodies - extracted
# by source position, never retyped - against a caller-chosen directory, so
# the property test exercises the real proof without running the whole
# (much larger, process-spawning) watchdog suite.
#
# Usage:
#   bl1728GitFixtureRootProofCli.sh good TMPROOT
#     mktemp's a fixture under TMPROOT, calls init_git_fixture_root on it,
#     and on success prints the fixture path on stdout.
#   bl1728GitFixtureRootProofCli.sh not-a-repo TARGET
#     calls prove_git_fixture_root directly against TARGET (an existing,
#     never git-inited directory) - expected to refuse.
#   bl1728GitFixtureRootProofCli.sh outside TARGET
#     calls prove_git_fixture_root directly against TARGET (an existing
#     directory nested inside a live enclosing checkout, but never itself
#     git-inited) - expected to refuse, naming the enclosing common-dir.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/../../../../swarmforge/scripts/test/test_operator_runtime_babysitterd_watchdog.sh"

# Extracts one function's definition, by its own `name() {` .. `}` markers -
# the source's own text, never a re-typed copy.
extract_fn() {
  sed -n "/^$1() {/,/^}/p" "$TARGET"
}

mode="${1:-}"
target="${2:?target directory required}"
fn_defs="$(extract_fn prove_git_fixture_root; extract_fn init_git_fixture_root)"

case "$mode" in
  good)
    d="$(mktemp -d "$target/bl1728-fixture-XXXXXX")"
    bash -c "$fn_defs; init_git_fixture_root '$d'" || exit $?
    printf '%s\n' "$d"
    ;;
  not-a-repo|outside)
    bash -c "$fn_defs; prove_git_fixture_root '$target'"
    exit $?
    ;;
  *)
    echo "usage: bl1728GitFixtureRootProofCli.sh good|not-a-repo|outside TARGET" >&2
    exit 2
    ;;
esac
