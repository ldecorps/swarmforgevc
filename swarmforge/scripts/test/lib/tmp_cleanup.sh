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
# BOUNDARY: a trap cannot catch SIGKILL/OOM - that residue is BL-413's
# periodic /tmp sweep's job, out of scope here.
__SWARMFORGE_TMP_DIRS_TO_CLEAN=()

__swarmforge_cleanup_tmp_dirs() {
  local d
  for d in "${__SWARMFORGE_TMP_DIRS_TO_CLEAN[@]}"; do
    [[ -n "$d" ]] && rm -rf -- "$d"
  done
}
trap __swarmforge_cleanup_tmp_dirs EXIT

register_tmp_dir() {
  __SWARMFORGE_TMP_DIRS_TO_CLEAN+=("$1")
}
