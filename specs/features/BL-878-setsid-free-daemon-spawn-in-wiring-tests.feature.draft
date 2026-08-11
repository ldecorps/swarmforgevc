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
