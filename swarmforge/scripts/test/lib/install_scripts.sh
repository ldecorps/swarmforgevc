#!/usr/bin/env bash
# BL-998: shared fixture-setup helper for shell test harnesses that dispatch
# a receive/completion helper against a fixture worktree - copying the real
# scripts tree into the fixture is what keeps a helper's own
# `cd "$(dirname "$0")"` (or a `.bb` dispatcher's process/exec of a sibling)
# inside the fixture instead of escaping to the real repo root. Ported
# verbatim from the five call sites that had each grown an identical copy
# (`test_ready_for_next_no_promotion.sh`, `test_ready_for_next_rotate_home.sh`,
# `test_idle_clear_respawn.sh`, `test_handoff_state_dir_worktree_root.sh`,
# `test_sidecar_tolerant_completion.sh`).
#
# Usage: source this file, then call `install_scripts "$fixture_worktree"`.
# Requires REAL_SCRIPTS_DIR to already be set by the caller.

install_scripts() {
  local wt="$1"
  mkdir -p "$wt/swarmforge/scripts"
  cp "$REAL_SCRIPTS_DIR"/*.bb "$REAL_SCRIPTS_DIR"/*.sh "$wt/swarmforge/scripts/"
}
