'use strict';

// BL-486 cleanup: this list was duplicated verbatim across three step
// files (controlLossIsNotAgentDeathSteps, alwaysOnOperatorPresenceSteps,
// noInboundMessageIsEverLostSteps), each building an isolated
// operator_runtime.bb fixture dir by copying exactly these named files.
// A file operator_runtime.bb depends on that's missing from this list
// throws FileNotFoundException on first load in every one of those
// scenarios at once (BL-412/413/458 predate this list catching up).
//
// BL-944: this list drifted from the real transitive load-file closure
// FIVE times before this comment existed (BL-412/413/458/647/655) and a
// sixth time silently, for fourteen days, before this ticket (BL-805
// added mono_router_lib.bb to handoff_lib.bb on 2026-08-05; nobody
// noticed until 2026-08-19). A "kept in sync" comment was never a gate -
// extension/test/operatorRuntimeBbFixtureClosure.test.js now derives the
// real closure from source on every parcel and fails naming exactly what
// drifted, closing the gap this comment used to paper over.
//
// operator_ask.bb was dropped here (BL-944): verified it is not reachable
// from operator_runtime.bb by ANY load-file chain, and none of the four
// step files that build this fixture spawn it from the fixture root
// either (the two callers that do run that CLI invoke it from REPO_ROOT,
// never through this list). OPERATOR_RUNTIME_BB_DECLARED_EXTRAS below is
// the deliberate escape hatch for a FUTURE file that legitimately needs to
// ride this fixture for a non-load-file reason - empty today because none
// exists; an entry there must say why, not just that it's needed.
const OPERATOR_RUNTIME_BB_FILES = [
  'operator_lib.bb',
  'operator_runtime.bb',
  // BL-647: operator_runtime.bb load-files both of these directly (lines
  // 50 and 77) - added 2026-07-22 (dc917a1e6) after this list was last
  // deduped (2026-07-17, 2c0e98bcf), so every existing consumer's fixture
  // was silently missing them until the rotation-router liveness wiring
  // needed swarm_identity_lib.bb and this fix closed the gap.
  'llm_cost_ledger_lib.bb',
  'swarm_identity_lib.bb',
  'telegram_topic_lib.bb',
  'support_lib.bb',
  'support_thread_store.bb',
  'operator_memory_lib.bb',
  'operator_memory_store.bb',
  'ticket_status_lib.bb',
  'handoff_lib.bb',
  // BL-655: handoff_lib.bb now load-files this too (ambulance mode's hold
  // predicate) - same "a new load-file dependency throws in every consumer
  // fixture at once" gap this list exists to close.
  'ambulance_lib.bb',
  // BL-944: handoff_lib.bb load-files both of these too (BL-805's
  // rotation-router-pack?, BL-546's recompose-role-prompt!) - the first
  // two of the seven files this ticket's closure walk found missing.
  'mono_router_lib.bb',
  'prompt_engine_lib.bb',
  'daemon_alarm_lib.bb',
  'disk_space_lib.bb',
  'sandbox_sweep_lib.bb',
  'bounded_delete_sweep_lib.bb',
  'proc_fd_scan_lib.bb',
  'fixture_reaper_lib.bb',
  'fixture_reaper_sweep_lib.bb',
  'orphan_agent_reaper_lib.bb',
  'orphan_agent_reaper_sweep_lib.bb',
  // BL-944: operator_runtime.bb load-files all four of these directly
  // (its own periodic sweeps section) - the remaining five of the seven
  // missing files (orphan_janitor_lib.bb arrives transitively via
  // orphan_janitor_sweep_lib.bb, never a direct load-file of
  // operator_runtime.bb itself).
  'orphan_janitor_sweep_lib.bb',
  'orphan_janitor_lib.bb',
  'hotfix_certification_lib.bb',
  'process_table_lib.bb',
  'babysitterd_freshness_lib.bb',
];

// BL-944 scenario 03: a file listed here but NOT reached by any load-file
// chain from operator_runtime.bb must be either dropped (operator_ask.bb's
// own resolution) or explicitly declared here with a reason - an
// undeclared extra is exactly how a list starts being treated as folklore
// instead of data. {file, reason} per entry.
const OPERATOR_RUNTIME_BB_DECLARED_EXTRAS = [];

module.exports = { OPERATOR_RUNTIME_BB_FILES, OPERATOR_RUNTIME_BB_DECLARED_EXTRAS };
