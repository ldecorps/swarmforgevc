Feature: The coordinator's context is cleared at a safe boundary after each ticket's bookkeeping close

  # An LLM agent re-sends its whole accumulated conversation as input on every
  # poke. Once a ticket is merged and the coordinator has closed it (BL-247:
  # QA lands main, coordinator bookkeeps), that ticket's dialogue is dead
  # weight paid again on every future wakeup - the coordinator is longest-
  # lived and bloats fastest. This clears the coordinator's session at that
  # exact boundary by injecting /clear into its pane via the already-proven
  # verified keystroke-injection path, immediately followed by the startup
  # re-read instruction the constitution already requires after any clear -
  # and only ever at a verified-idle boundary, never mid-build.

  # BL-309 clear-fires-at-safe-close-01
  Scenario: the coordinator is cleared after it finishes a ticket's bookkeeping close and goes idle
    Given the coordinator has just completed its bookkeeping close for a ticket
    And the coordinator is idle with no in-process task and an empty inbox
    When the closing-context-clear check runs
    Then a clear is injected into the coordinator's pane
    And the startup re-read instruction is injected immediately after

  # BL-309 no-clear-while-not-idle-02
  Scenario Outline: no clear is injected while the coordinator is not idle
    Given the coordinator has just completed its bookkeeping close for a ticket
    And the coordinator is not idle because it has <reason>
    When the closing-context-clear check runs
    Then no clear is injected

    Examples:
      | reason                      |
      | an in-process task          |
      | a pending inbox item        |

  # BL-309 no-repeat-clear-same-close-03
  Scenario: a clear already issued for the coordinator's most recent close is not issued again
    Given a clear was already issued for the coordinator's most recent bookkeeping close
    And no new bookkeeping close has happened since
    When the closing-context-clear check runs
    Then no clear is injected

  # BL-309 new-close-triggers-again-04
  Scenario: a later, different ticket close triggers a clear again
    Given a clear was already issued for the coordinator's most recent bookkeeping close
    And the coordinator has since completed its bookkeeping close for a different ticket
    And the coordinator is idle with no in-process task and an empty inbox
    When the closing-context-clear check runs
    Then a clear is injected into the coordinator's pane
