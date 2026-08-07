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
    # BL-849 (Darwin orphan-janitor) added this dependency to orphan_agent_
    # reaper_sweep_lib.bb/orphan_janitor_lib.bb without updating this shared
    # list - every sandboxed operator_runtime test was failing to load
    # before this fix, unrelated to whatever that test is actually about.
    process_table_lib.bb
    operator_ask.bb
    ambulance_lib.bb
    hotfix_certification_lib.bb
    # BL-848: hotfix-certification-sweep! shells to swarm_handoff.bb (never
    # hand-writes an inbox file, per the coordinator-nudge constraint) - its
    # full load-file transitive closure, so a sandboxed --tick-once can
    # exercise that real send path end to end.
    swarm_handoff.bb
    handoff_inject_lib.bb
    agent_runtime_lib.bb
    agent_runtime_inject.bb
    prompt_engine_lib.bb
    chase_sweep_lib.bb
    claim_progress_lib.bb
    backlog_depth_lib.bb
    pipeline_stage_lib.bb
    salvage_lib.bb
    duplicate_chain_guard_lib.bb
    pre_qa_gate_lib.bb
    acceptance_contract_gate_lib.bb
    pre_qa_gate_gather_lib.bb
    coordinator_config_lib.bb
    required_stages_lib.bb
    ticket_close_guard_lib.bb
    mono_router_lib.bb
  )

  local f
  for f in "${libs[@]}"; do
    if [[ -f "$src/$f" ]]; then
      cp "$src/$f" "$dest/"
    fi
  done
}
