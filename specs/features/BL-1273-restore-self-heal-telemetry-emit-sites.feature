Feature: Self-heal telemetry has production emit sites again

  BL-597 shipped a self-heal telemetry ledger with five production emit
  sites; merge 2e37477ec dropped all five an hour later, leaving the
  aggregator reading a file nothing ever writes. These scenarios pin the
  writers back into the recovery hosts. BL-1262 restores the reading half
  (aggregator, store, CLI, lib test runner) and must land first.

  Every scenario here is a static check over the tree, which can pass over
  code that never executes; the live end-to-end that proves a production
  writer actually appends - one real kill_all_swarm recovery growing the
  month's ledger by one line - is a manual step in the ticket's
  qa_e2e_procedure, because it needs a running swarm and has no runnable
  binding here.

  Background:
    Given the repository at the parcel commit
    And BL-1262's restored files are present

  # BL-1273 restore-self-heal-telemetry-emit-sites-01
  Scenario Outline: Each recovery host emits its self-heal event again
    Given the recovery host <host>
    When its self-heal emit site is inspected
    Then the host references <emit_symbol>
    And the emit sits at the existing prose log line for <event_type>

    Examples:
      | host                      | emit_symbol                | event_type            |
      | front_desk_supervisor.bb  | append-self-heal-event!    | stale-build-recompile |
      | front_desk_supervisor.bb  | append-self-heal-event!    | supervisor-respawn    |
      | handoffd.bb               | append-self-heal-event!    | claim-heal            |
      | handoff_lib.bb            | append-self-heal-event!    | rotation-respawn      |
      | kill_pipeline_swarm.sh    | self_heal_telemetry_cli.bb | kill_all              |

  # BL-1273 restore-self-heal-telemetry-emit-sites-02
  Scenario: No host loads the telemetry lib without calling it
    Given every script under swarmforge/scripts at the parcel commit
    When the scripts that load self_heal_telemetry_lib.bb are collected
    Then every collected script also calls append-self-heal-event!

  # BL-1273 restore-self-heal-telemetry-emit-sites-03
  Scenario: The standing property test for the emit hosts passes
    Given the property suite command for the extension
    When selfHealTelemetry.property.test.js is run
    Then its known-emit-hosts invariant passes
    And its every-known-host-loads-the-shared-lib invariant passes
