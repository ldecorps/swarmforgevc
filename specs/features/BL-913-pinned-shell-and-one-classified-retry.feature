# mutation-stamp: sha256=ad669a6cbbb7fb8d9c5f096b2b0123955422f04a562d67e4beb24db26a0597db
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-18T08:20:25.351106Z","feature_name":"A recoverable tool miss is healed once from the pinned execution environment, and a real failure is returned honestly","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-913-pinned-shell-and-one-classified-retry.feature","background_hash":"8866222fa0ac22f177cf605ac6aaa5151489aeb9355fd17413337e36934694fb","implementation_hash":"unknown","scenarios":[{"index":0,"name":"each recoverable miss class is re-run once from the right place","scenario_hash":"03d35d508947b5279f4afc9994bc77202d528f7fe4b90080c2e9dc904daeb7de","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-18T08:20:25.351106Z"}]}
# acceptance-mutation-manifest-end

Feature: A recoverable tool miss is healed once from the pinned execution environment, and a real failure is returned honestly

  # BL-913 (epic tool-miss-auto-heal, slice A of the BL-912 tracker): a role's shell
  # commands run from an environment pinned to that role's own worktree rather than from
  # whatever cwd the pane last drifted to. When a command still misses in one of three
  # recoverable ways, the substrate classifies it and re-runs it ONCE from the right
  # place, and the model receives only the healed result. Anything else — a red test, a
  # conflict, a permission error — comes back exactly as it happened, once, with no retry.
  # The human's direction: "make the shell un-wrong, heal one miss in silence, then fail
  # honestly."
  #
  # `<miss>` is the classifier's own verdict and is the handler's lookup key; validate it
  # against explicit KNOWN_VALUES rather than branching on scenario shape, or a mutant in
  # that column survives.

  Background:
    Given a role whose pinned execution environment is its own worktree

  # BL-913 a-recoverable-miss-is-healed-once-01
  Scenario Outline: each recoverable miss class is re-run once from the right place
    Given a command that misses because of "<miss>"
    When the role runs that command
    Then the command is re-run once from "<healed environment>"
    And the model receives only the healed result

    Examples:
      | miss              | healed environment           |
      | wrong-cwd         | the role's own worktree      |
      | wrong-surface     | the extension directory      |
      | missing-root-argv | the same place, with the project root supplied |

  # BL-913 a-real-failure-is-returned-as-it-happened-02
  Scenario: a genuine failure is never reclassified as a recoverable miss
    Given a command that fails for a reason outside the recoverable classes
    When the role runs that command
    Then the command is not re-run
    And the model receives that failure exactly once

  # BL-913 one-retry-then-stop-03
  Scenario: a heal that misses the same way again stops rather than looping
    Given a command that misses because of "wrong-cwd"
    And the healed re-run misses the same way
    When the role runs that command
    Then the command is not re-run a second time
    And the model receives the failure of the healed re-run

  # BL-913 a-command-that-works-is-left-alone-04
  Scenario: a command that succeeds where it was issued is untouched
    Given a command that succeeds as issued
    When the role runs that command
    Then the command is not re-run
    And the model receives the result of the command as issued
