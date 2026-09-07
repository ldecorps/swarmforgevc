Feature: BL-1457 Every test that drives the launcher's parse_config on a fixture decides the staffing gate itself

  BL-1318 put the pack staffing gate inside the launcher's parse_config: a
  window line whose model is on no role matrix is refused before any seat is
  staffed, unless PACK_STAFFING_SKIP_GATE=1, the operator escape hatch that
  the launch environment file has exported into every role pane since about
  2026-09-04. Two property files drive parse_config on a fixture root that
  carries no role matrix at all, so their verdict is decided by whether that
  hatch happens to be in the ambient environment: green in every role pane,
  red in any shell without it. QA's offline expedite run of BL-1454 on
  2026-09-07 was such a shell; both files failed on every draw and held an
  unrelated parcel under Article 4.2.

  A test's verdict on a fixture is decided by the fixture. Whether the
  fixture admits the model on merit or the test declares the override in the
  environment it spawns is the coder's choice; what may not remain is a
  spawn that inherits the answer from the pane.

  # BL-1457 a-fixture-driving-property-file-passes-whatever-the-pane-exports-01
  Scenario Outline: a fixture-driving property file passes whatever the pane exports for the override
    Given the environment exports PACK_STAFFING_SKIP_GATE as <value>
    When <file> runs alone under its lane's runner
    Then every test in it passes

    Examples:
      | file                                                                       | value |
      | extension/test/bl1218RemoteControlConfigInvariants.property.test.js       | unset |
      | extension/test/bl1218RemoteControlConfigInvariants.property.test.js       | 1     |
      | extension/test/bl1320DocumentedStepsAreExecutedInvariants.property.test.js | unset |
      | extension/test/bl1320DocumentedStepsAreExecutedInvariants.property.test.js | 1     |

  # BL-1457 the-override-is-never-declared-lane-wide-02
  Scenario: the override is never declared lane-wide
    When the vitest configurations under extension are inspected
    Then none of them exports PACK_STAFFING_SKIP_GATE into every test's environment

  # BL-1457 every-other-fixture-driving-test-still-passes-without-the-override-03
  Scenario Outline: every other test that drives parse_config on a fixture still passes with the override unset
    Given the environment does not export PACK_STAFFING_SKIP_GATE
    When <file> runs alone under its lane's runner
    Then every test in it passes

    Examples:
      | file                                                                          |
      | extension/test/bl1010SwarmNameResolution.test.js                              |
      | extension/test/bl1078CursorSeatUsesSharedChannels.property.test.js            |
      | extension/test/bl1324ClaudeSeatQwenCloudContextWindowInvariants.property.test.js |
      | extension/test/bl1328QwenModelTokenFormsInvariants.property.test.js           |
      | extension/test/swarmforgeShErrorChannelGuard.test.js                          |

  # BL-1457 the-register-rows-leave-with-the-fix-04
  Scenario: the register rows for both files leave with the fix
    When the fix is on main
    Then backlog/standing-reds.tsv carries no row for either file
