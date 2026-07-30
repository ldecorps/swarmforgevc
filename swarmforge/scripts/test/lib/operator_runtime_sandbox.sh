#!/usr/bin/env bash
# BL-671: shared sandbox copy for operator_runtime.bb + every lib it load-files
# (and the small set of sibling helpers fixtures already needed).
#
# Usage (from a test_operator_runtime_*.sh):
#   source "$SCRIPT_DIR/lib/operator_runtime_sandbox.sh"
#   copy_operator_runtime_sandbox "$SRC" "$dest/swarmforge/scripts"
#
# Adding a new load-file in operator_runtime.bb: update OPERATOR_RUNTIME_SANDBOX_LIBS
# here once — every fixture picks it up without a per-fixture edit.

copy_operator_runtime_sandbox() {
  local src="${1:?copy_operator_runtime_sandbox: src dir}"
  local dest="${2:?copy_operator_runtime_sandbox: dest dir}"
  mkdir -p "$dest"

  # Keep in sync with (load-file ...) forms in operator_runtime.bb, plus
  # helpers fixtures historically copied alongside (operator_ask, *reaper_lib,
  # ambulance_lib) so ticks that touch those paths keep working.
  local libs=(
    operator_runtime.bb
    operator_lib.bb
    llm_cost_ledger_lib.bb
    telegram_topic_lib.bb
    support_lib.bb
    support_thread_store.bb
    operator_memory_lib.bb
    operator_memory_store.bb
    ticket_status_lib.bb
    handoff_lib.bb
    swarm_identity_lib.bb
    daemon_alarm_lib.bb
    disk_space_lib.bb
    sandbox_sweep_lib.bb
    bounded_delete_sweep_lib.bb
    proc_fd_scan_lib.bb
    fixture_reaper_sweep_lib.bb
    fixture_reaper_lib.bb
    orphan_agent_reaper_sweep_lib.bb
    orphan_agent_reaper_lib.bb
    orphan_janitor_sweep_lib.bb
    orphan_janitor_lib.bb
    operator_ask.bb
    ambulance_lib.bb
  )

  local f
  for f in "${libs[@]}"; do
    if [[ -f "$src/$f" ]]; then
      cp "$src/$f" "$dest/"
    fi
  done
}
