# mutation-stamp: sha256=eac0b80b33c2ed7f713baf1f2856e169bb9e9d52711c68c6190d8d525223148d
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-11T17:17:16.004747Z","feature_name":"Handoffd wiring tests spawn their daemon without requiring setsid","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-878-setsid-free-daemon-spawn-in-wiring-tests.feature","background_hash":"d6e8b111530e2ad1b75d66859064cafb0458a75281da0cf002b87d118ad490f4","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the daemon starts and the test passes on either host","scenario_hash":"91b3a837113ed571f63bfd4a92f6135d35c01795849456199143b119c16072f8","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-11T17:17:16.004747Z"},{"index":1,"name":"no daemon survives the test that started it","scenario_hash":"1cbef834355cb1486c50b3703914abd12f433c1ad6c9e7ae03b1f1269b9187d1","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-11T17:17:16.004747Z"}]}
# acceptance-mutation-manifest-end

Feature: Handoffd wiring tests spawn their daemon without requiring setsid

  These tests need a daemon detached enough to outlive the subshell that
  started it. `setsid` gives that on Linux and does not exist on macOS. The
  detachment is what the tests actually depend on; `setsid` is one way to get
  it, not the requirement.

  Background:
    Given a handoffd wiring test pointed at a private fixture root
    And a fake bin directory ahead of PATH so no real tmux or mailer is touched

  # BL-878 setsid-free-daemon-spawn-01
  Scenario Outline: the daemon starts and the test passes on either host
    Given a host on which setsid is <setsid availability>
    When the test spawns the handoff daemon
    Then the daemon starts
    And the test reaches its assertions and passes

    Examples:
      | setsid availability |
      | present             |
      | absent              |

  # BL-878 setsid-free-daemon-spawn-02
  Scenario Outline: no daemon survives the test that started it
    Given a host on which setsid is <setsid availability>
    When the test spawns the handoff daemon
    And the test finishes and runs its cleanup
    Then no handoff daemon rooted at that fixture root is still running

    Examples:
      | setsid availability |
      | present             |
      | absent              |

  # BL-878 setsid-free-daemon-spawn-03
  Scenario: a tool the spawn genuinely needs fails loudly, not as a timeout
    Given a host on which a tool the daemon spawn requires cannot be resolved
    When the test spawns the handoff daemon
    Then the test fails naming the missing tool
    And it fails without waiting out its daemon-startup timeout
