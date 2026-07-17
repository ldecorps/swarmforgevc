'use strict';

// BL-486 cleanup: this list was duplicated verbatim across three step
// files (controlLossIsNotAgentDeathSteps, alwaysOnOperatorPresenceSteps,
// noInboundMessageIsEverLostSteps), each building an isolated
// operator_runtime.bb fixture dir by copying exactly these named files.
// A file operator_runtime.bb depends on that's missing from this list
// throws FileNotFoundException on first load in every one of those
// scenarios at once (BL-412/413/458 predate this list catching up).
const OPERATOR_RUNTIME_BB_FILES = [
  'operator_lib.bb',
  'operator_runtime.bb',
  'telegram_topic_lib.bb',
  'support_lib.bb',
  'support_thread_store.bb',
  'operator_memory_lib.bb',
  'operator_memory_store.bb',
  'ticket_status_lib.bb',
  'operator_ask.bb',
  'handoff_lib.bb',
  'daemon_alarm_lib.bb',
  'disk_space_lib.bb',
  'sandbox_sweep_lib.bb',
  'bounded_delete_sweep_lib.bb',
  'proc_fd_scan_lib.bb',
  'fixture_reaper_lib.bb',
  'fixture_reaper_sweep_lib.bb',
  'orphan_agent_reaper_lib.bb',
  'orphan_agent_reaper_sweep_lib.bb',
];

module.exports = { OPERATOR_RUNTIME_BB_FILES };
