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
