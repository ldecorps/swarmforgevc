# mutation-stamp: sha256=147fa00de4ecf007c7711038f2691cef3b7138bbaa5059f11eda1ad94479f1d1
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-08T03:32:51.322015028Z","feature_name":"BL-1445 The staffing-gate wiring test decides the operator override itself","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1445-the-staffing-gate-wiring-test-decides-the-override-itself.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the wiring test passes every case whatever the pane exports for the override","scenario_hash":"064d3eff338891f42cfca680a3618b06c5dc9154b5a5cff40158871deaa499fa","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-08T03:32:51.322015028Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1445 The staffing-gate wiring test decides the operator override itself

  swarmforge/scripts/test/test_pack_staffing_gate_wiring.sh (BL-1318) sources
  the real launcher and proves its parse_config loop calls the pack staffing
  gate and refuses an uncleared seat before returning. Its refusal cases read
  PACK_STAFFING_SKIP_GATE from whatever environment the test runs in. Since
  the launch environment file began exporting PACK_STAFFING_SKIP_GATE=1 into
  every role pane (the documented operator escape hatch, in place while the
  full-forge pack has an uncertified seat), every refusal the test expects
  turns into a loud OVERRIDE warning and parse_config returns: case 01 fails
  in every role's lane on main, and the same file passes under `env -u`. A
  test that asserts against the pane's configuration instead of its fixture
  is the failure shape the hardener's 2026-08-12 rule names for SWARMFORGE_*
  variables; this feature is that the rule holds for the override too, and
  for every test that sources the launcher and asserts on the gate.

  # BL-1445 the-wiring-test-passes-under-every-pane-export-01
  Scenario Outline: the wiring test passes every case whatever the pane exports for the override
    Given the environment exports PACK_STAFFING_SKIP_GATE as <value>
    When the wiring test runs
    Then it passes every case

    Examples:
      | value |
      | 1     |
      | 0     |
      | unset |

  # BL-1445 every-launcher-test-that-asserts-on-the-gate-sets-the-override-itself-02
  Scenario: every test that sources the launcher and asserts on the staffing gate sets or unsets the override itself
    When every shell test under swarmforge/scripts/test that sources swarmforge.sh is inspected
    Then each one that asserts on the staffing gate's refusal or override warning sets or unsets PACK_STAFFING_SKIP_GATE explicitly before sourcing the launcher
