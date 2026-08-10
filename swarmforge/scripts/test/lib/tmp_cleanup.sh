#!/usr/bin/env bash
# BL-459: shared cleanup registry for swarmforge/scripts/test/*.sh harnesses
# that create mktemp -d temp roots - the shell sibling of
# extension/test/helpers/tmpDir.js's own "one shared registry, one place
# cleanup happens, on both the pass and throw path" discipline (BL-420).
#
# Usage: source this file, then call `register_tmp_dir "$your_var"`
# IMMEDIATELY after each `mktemp -d`-derived assignment. A single EXIT trap
# (installed once below) removes every registered root - it fires on a
# clean exit AND on a failing one (any `set -e`-triggered early exit, an
# explicit `exit N`, or an unhandled error), so a root a script's own inline
# `rm -rf` never reached because a LATER assertion failed first still gets
# cleaned up. Each registered path is captured as an immutable STRING at
# call time, so reusing the same variable name for several sequential
# fixtures (a common pattern in this tree) correctly accumulates every one
# of them, not just the last.
#
# BL-801: the established call convention across this tree wraps
# registration in a helper invoked via command substitution -
#   make_root() { local d; d="$(mktemp -d)"; register_tmp_dir "$d"; printf '%s' "$d"; }
#   ROOT="$(make_root)"
# `$(...)` runs the helper in a forked subshell; a plain shell ARRAY lives
# only in that subshell's copy of memory and is discarded when the subshell
# exits, so the registration was silently lost (every-host leak) and, with
# the array left empty, `"${arr[@]}"` under `set -u` on bash < 4.4 (stock
# macOS /bin/bash is 3.2.57) raised "unbound variable" in the EXIT trap -
# turning a fully passing suite into a false exit 1. A FILE survives a fork
# the way a shell variable never can, so the registry is now a file, keyed
# per top-level script process (captured once, below, before this script's
# own code can fork any subshell) rather than a shell array: register_tmp_dir
# appends a line to it from whatever shell depth it runs at, and the trap
# reads it back with a plain `while read` loop, which touches no array
# index and so cannot raise "unbound variable" on any bash regardless of
# how many lines it holds - including zero.
#
# Registering scripts never share a registry: __SWARMFORGE_TMP_CLEANUP_REGISTRY
# is set from a fresh `mktemp` exactly once per top-level process (the guard
# below short-circuits a second `source` of this file in the SAME process,
# and every separate `bash some_test.sh` invocation is its own process with
# its own environment to begin with) - one script's EXIT trap sweeps only
# the file it created, never a path a concurrently running sibling script
# owns.
#
# Confirmed empirically on the target bash (GNU bash 3.2.57, macOS): an
# EXIT trap installed before a `$(...)` command substitution runs does NOT
# re-fire when that subshell itself exits - only the top-level script's own
# exit fires it. This is what makes "append from inside the subshell, sweep
# once from the top-level trap" safe: the subshell's own implicit exit never
# prematurely sweeps a registry the top-level script is still adding to.
#
# BOUNDARY: a trap cannot catch SIGKILL/OOM - that residue is BL-413's
# periodic /tmp sweep's job, out of scope here.

if [[ -z "${__SWARMFORGE_TMP_CLEANUP_REGISTRY:-}" ]]; then
  __SWARMFORGE_TMP_CLEANUP_REGISTRY="$(mktemp -t swarmforge-tmp-cleanup-registry)"
  export __SWARMFORGE_TMP_CLEANUP_REGISTRY

  __swarmforge_cleanup_tmp_dirs() {
    local registry="$__SWARMFORGE_TMP_CLEANUP_REGISTRY"
    local d
    if [[ -f "$registry" ]]; then
      while IFS= read -r d || [[ -n "$d" ]]; do
        [[ -n "$d" ]] && rm -rf -- "$d"
      done < "$registry"
      rm -f -- "$registry"
    fi
  }
  trap __swarmforge_cleanup_tmp_dirs EXIT
fi

register_tmp_dir() {
  printf '%s\n' "$1" >> "$__SWARMFORGE_TMP_CLEANUP_REGISTRY"
}
