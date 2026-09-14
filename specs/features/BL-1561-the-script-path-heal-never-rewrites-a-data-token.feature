Feature: BL-1561 The script-path heal rewrites helpers it would run, never data it would read

  Hotfix 1fc9065605 (stamped by BL-1560) repoints every root-level ./x.sh
  token of a missed command at ./swarmforge/scripts/x.sh and, for that class
  alone, opens the heal chain on a tail-masked exit 0 whenever the captured
  output carries the miss text. Both halves are blind to WHERE the token
  sits: a grep whose search string names ./ready_for_next.sh prints the miss
  line it found, exits 0, and is re-run with its search string rewritten -
  the model sees a line nobody wrote, or nothing. BL-912's direction is
  "heal one miss in silence, then fail honestly"; a successful command must
  never be re-run with its data changed. After this ticket a helper token is
  rewritten only in command position, and the masked opener fires only when
  that helper is really absent at the root and present under the pin.

  Background:
    Given a fixture worktree whose ready_for_next.sh lives only under swarmforge/scripts and counts its runs

  # BL-1561 script-path-heal-data-token-01
  Scenario Outline: only a command-position helper token is repointed
    Given the original command is <command>
    When the missing-script-path heal is composed for the pinned worktree
    Then the heal <outcome>

    Examples:
      | command                                                              | outcome                                                       |
      | a root-level ready_for_next.sh piped into tail                       | re-runs it from the pin with the helper under swarmforge/scripts |
      | a cd into a directory then a root-level ready_for_next.sh            | re-runs it from the pin with the helper under swarmforge/scripts |
      | a grep whose quoted search string names ready_for_next.sh            | declines                                                      |
      | a git log whose grep flag names ready_for_next.sh                    | declines                                                      |
      | an echo of a sentence that mentions ready_for_next.sh                | declines                                                      |
      | a root-level done_with_current.sh then a grep naming ready_for_next.sh | re-runs it from the pin repointing only done_with_current.sh |

  # BL-1561 script-path-heal-data-token-02
  Scenario: a successful grep that prints the miss text is not re-run and its match is reported as written
    Given a log file in the fixture worktree holding the zsh miss line for ready_for_next.sh
    When the real healing wrapper runs a grep for that line from the fixture worktree root
    Then the model sees the log file's line exactly as written with exit 0
    And the helper never ran

  # BL-1561 script-path-heal-data-token-03
  Scenario: the masked root-level miss still heals once
    Given a shell parked outside that worktree
    When the real healing wrapper runs the original root-level ready_for_next.sh piped into tail
    Then the model sees the helper's own output with exit 0
    And the helper ran exactly once
