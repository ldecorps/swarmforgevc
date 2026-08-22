Feature: BL-1064 every log literal is grounded against the source that writes it
  The non-pipeline-agents reference table grounds each row's log literal by
  reading the script its Launcher column links. That fallback is wrong whenever
  the log is written by something other than the launcher, and the table already
  carries explicit overrides for three such rows. The Front Desk row is a fourth
  and has no override: it names BL-582's diagnostics sink, which the bot writes,
  while the launcher writes only the supervisor log. The row is ungrounded, so
  both bl643 property tests fail deterministically on every host - this is not
  flakiness and not load.

  # BL-1064 log-grounding-source-01
  Scenario: a log written somewhere other than the launcher declares its writer
    Given a row whose log literal is written by something other than its launcher
    When the row's verification sources are resolved
    Then the resolved sources include the file that writes that literal

  # BL-1064 log-grounding-source-02
  Scenario Outline: every Front Desk log literal is grounded
    When the "Front Desk" row's log literal <literal> is grounded
    Then it is found in at least one of the row's verification sources

    Examples:
      | literal                    |
      | front-desk-supervisor.log  |
      | front-desk-diagnostics.log |

  # BL-1064 log-grounding-source-03
  Scenario: the grounding check stays non-vacuous
    Given a row carrying a log literal no verification source contains
    When the grounding check runs
    Then it fails and names that row and that literal
