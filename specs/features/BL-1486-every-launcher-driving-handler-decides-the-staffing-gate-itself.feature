# mutation-stamp: sha256=200e9c3ca5ea8502133424dfa65a0e7fa797e68b407061517a9486f2ba47fad5
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-15T03:47:45.555955636Z","feature_name":"BL-1486 Every step handler that drives the launcher on a fixture decides the staffing gate itself","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1486-every-launcher-driving-handler-decides-the-staffing-gate-itself.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a launcher-driving feature passes with the override absent from the environment","scenario_hash":"664a8050dd139209619004ce0e21fa91fd6e061e9dadc443f000f8ca295e8958","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-09-15T03:47:45.555955636Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1486 Every step handler that drives the launcher on a fixture decides the staffing gate itself

  BL-1318 put the pack staffing gate inside the launcher's parse_config:
  a window line whose model is on no role matrix is refused unless
  PACK_STAFFING_SKIP_GATE=1, the operator escape hatch the launch
  environment has exported into every role pane since about 2026-09-04.
  Six step handlers drive parse_config on fixture roots that carry no role
  matrix and spawn with the pane environment spread in, so their verdict is
  decided by whether that hatch happens to be present: green in every role
  pane, red in any shell without it - the offline expedite shell among
  them. BL-1457 fixed the same inheritance for two property files and
  BL-1445 for the shell wiring test; this feature is the acceptance lane
  and one shell test that parses the shipped confs: a test's verdict on a
  fixture is decided by the fixture or by an override the test declares
  itself, never by the pane.

  # BL-1486 a-launcher-driving-feature-passes-without-the-pane-override-01
  Scenario Outline: a launcher-driving feature passes with the override absent from the environment
    Given the environment does not export PACK_STAFFING_SKIP_GATE
    When the feature <feature> runs under the acceptance runner
    Then every scenario in it passes

    Examples:
      | feature                                                              |
      | BL-1052-a-role-seat-can-be-staffed-by-a-downloaded-local-model       |
      | BL-1218-config-off-is-honored-over-an-explicit-window-flag           |
      | BL-1320-operator-step-for-adding-a-seat-to-a-bottleneck-stage        |
      | BL-1418-the-art-director-seat-is-addressable                         |
      | BL-961-launcher-exports-swarmforge-pack-into-role-shells             |
      | BL-628-bare-host-bootstrap-for-autonomous-swarm                      |

  # BL-1486 the-shipped-confs-test-parses-without-the-pane-override-02
  Scenario: the shipped-confs shell test parses every shipped conf with the override absent from the environment
    Given the environment does not export PACK_STAFFING_SKIP_GATE
    When the shipped-confs shell test runs
    Then no shipped conf is refused by the staffing gate

  # BL-1486 every-parse-config-driving-handler-declares-the-override-in-its-own-spawn-03
  Scenario: every step handler that drives parse_config and does not assert on the gate declares the override in its own spawn
    When every step handler under specs/pipeline/steps that drives parse_config is inspected
    Then each one that does not assert on the staffing gate sets PACK_STAFFING_SKIP_GATE explicitly in the environment it spawns
    And no handler relies on the variable being present in the pane

  # BL-1486 the-override-is-never-declared-lane-wide-04
  Scenario: the override is never declared lane-wide
    When the acceptance runner and its scripts are inspected
    Then none of them exports PACK_STAFFING_SKIP_GATE into every handler's environment
