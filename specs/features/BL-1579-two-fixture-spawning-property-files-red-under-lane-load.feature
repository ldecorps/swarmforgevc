# mutation-stamp: sha256=b22155af916f65a9c04b9e617b08dbda36b5cf371710f495f5799f78650e2320
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-15T19:40:53.353105342Z","feature_name":"BL-1579 Two fixture-spawning property files are green under lane load","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1579-two-fixture-spawning-property-files-red-under-lane-load.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"each property file is green on the tree as it stands","scenario_hash":"9d036a9ca809379c13db47c05dc434c90b90c752c8e2a67e155263e654615872","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-15T19:40:53.353105342Z"},{"index":1,"name":"the parcel's evidence records the observed failure and its remedy for each file","scenario_hash":"cbce3c5455d1b8836e275d4aaf994244b48426471fbed9cd4105bc3fc4e86c1f","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-15T19:40:53.353105342Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1579 Two fixture-spawning property files are green under lane load

  QA's third property-lane run on the BL-1509 parcel (2026-09-15) reported
  bl1343ReplayNeverDropsOwnPathInvariants and bl1323StampOffInvariants
  red and described each as a reach-floor assertion, with no assertion
  text recorded. Neither file can miss a floor: both iterate their shapes
  by construction, and the one draw-dependent floor missed 0 of 3000
  simulated seeds. Both spawn a git or bb fixture per draw and run 10 to
  13 seconds alone against the lane's 20-second test timeout, and QA's
  runs were concurrent with a Stryker run and a full unit suite. This
  feature is that the parcel reproduces the red with its text recorded,
  removes the observed cause without lowering a floor or deleting an
  assertion, and leaves both files green alone and under lane load, or
  retires the rows on the recorded green runs when nothing reproduces.

  # BL-1579 two-fixture-spawning-property-files-green-under-load-01
  Scenario Outline: each property file is green on the tree as it stands
    When <file> runs alone under the properties config
    Then every test in it passes

    Examples:
      | file                                                                    |
      | extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js |
      | extension/test/bl1323StampOffInvariants.property.test.js                |

  # BL-1579 two-fixture-spawning-property-files-green-under-load-02
  Scenario Outline: the parcel's evidence records the observed failure and its remedy for each file
    When the parcel's evidence for <file> is read
    Then it records the failing test name and the assertion or timeout message verbatim from a lane run under concurrent load and the change that removed it, or it records at least 5 loaded lane runs and 20 runs alone all green and the register row retired on that evidence

    Examples:
      | file                                                                    |
      | extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js |
      | extension/test/bl1323StampOffInvariants.property.test.js                |
