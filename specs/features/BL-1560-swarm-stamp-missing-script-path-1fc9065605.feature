Feature: BL-1560 Stamp-off review of the seats-stop-hunting-for-ready_for_next hotfix

  BL-848 review-only certification of landed commit 1fc9065605 (2026-09-14).
  Human direction 2026-09-14, from the commit: "seats stop hunting for
  ready_for_next.sh at the worktree root". Every boot nudge said "run
  ready_for_next.sh"; the helper lives in swarmforge/scripts/ (on PATH via the
  launch script), so seats typed ./ready_for_next.sh at the worktree root, got
  "no such file or directory", and hunted with find / until the Bash tool's
  120 s cap - 258 attempts and 121 root-level finds in the week to 09-14, 31
  attempts and 4 hunts on 09-14 before the fix landed, none after. The hotfix
  names ./swarmforge/scripts/ready_for_next.sh in every generated boot nudge
  and the RESUME-ON-START note, and adds a fourth tool-miss heal class,
  missing-script-path, that repoints every root-level ./x.sh token of the
  original command at ./swarmforge/scripts/x.sh and re-runs it once from the
  pinned worktree, opening even on a tail-masked exit 0 for this class alone.

  These scenarios confirm or refute what landed; none may rewrite it, and
  none writes a certify or waive decision into backlog/hotfix-ledger.yaml -
  only a recorded human decision does that. The two findings made while
  minting are probed in evidence and never asserted here: a command naming
  ./x.sh as data whose exit-0 output echoes the miss text is re-run with its
  data rewritten (BL-1561), and the tmux wake nudge still says the bare name
  (BL-1562).

  # BL-1560 swarm-stamp-missing-script-path-01
  Scenario Outline: the classifier names the new class only for a root-level script miss and keeps the older classes' precedence
    Given a captured first attempt whose output is <output>
    When the miss is classified
    Then the verdict is <verdict>

    Examples:
      | output                                                        | verdict             |
      | the zsh spelling of a missing root-level ready_for_next.sh    | missing-script-path |
      | the bash spelling of a missing root-level done_with_current.sh | missing-script-path |
      | the bash spelling of a missing root-level notes.txt           | real-failure        |
      | the bash spelling of a missing ready_for_next.sh already under swarmforge/scripts | real-failure |
      | a root-level script miss beside an npm package.json ENOENT    | wrong-surface       |
      | a root-level script miss beside fatal not a git repository    | wrong-cwd           |

  # BL-1560 swarm-stamp-missing-script-path-02
  Scenario Outline: the heal repoints only bare root-level helper tokens and declines otherwise
    Given the original command is <command>
    When the missing-script-path heal is composed for the pinned worktree
    Then the heal <outcome>

    Examples:
      | command                                                        | outcome                                                                 |
      | a root-level ready_for_next.sh piped into tail                 | re-runs the pipeline from the pin with the helper under swarmforge/scripts and the tail kept |
      | a root-level done_with_current.sh then ready_for_next.sh in one sequence | re-runs the sequence from the pin with both helpers under swarmforge/scripts |
      | ready_for_next.sh already under swarmforge/scripts             | declines                                                                |
      | a command naming no shell script at all                        | declines                                                                |
      | a script name that is the tail of a longer path                | declines                                                                |

  # BL-1560 swarm-stamp-missing-script-path-03
  Scenario: the real composed wrapper heals the masked root-level miss end to end
    Given a fixture worktree whose ready_for_next.sh lives only under swarmforge/scripts and counts its runs
    And a shell parked outside that worktree
    When the real healing wrapper runs the original root-level ready_for_next.sh piped into tail
    Then the model sees the helper's own output with exit 0
    And the helper ran exactly once
    And no "no such file" text reaches the model

  # BL-1560 swarm-stamp-missing-script-path-04
  Scenario: a command naming no helper keeps the exit-code-only gate
    When the real healing wrapper is composed for a plain git status
    Then its chain opens on a non-zero exit only
    And it carries no swarmforge/scripts repointing clause

  # BL-1560 swarm-stamp-missing-script-path-05
  Scenario: the hotfix's own runner is green and still carries its cases
    When the tool-miss heal lib test runner runs
    Then it reports all tests pass
    And its source still carries the missing-script-path section and the one-run end-to-end assertion

  # BL-1560 swarm-stamp-missing-script-path-06
  Scenario: every rendered boot nudge and the resume note name the helper's real path
    Given a fixture root seating one role on each of claude, codex, cursor, gemini and local-model
    And one of those roles holds a leftover in_process parcel
    When the real launch scripts are rendered
    Then all five launch bodies tell the seat to run ./swarmforge/scripts/ready_for_next.sh and that it is not at the worktree root
    And no launch body tells the seat to run the bare ready_for_next.sh
    And the rendered RESUME-ON-START note names ./swarmforge/scripts/ready_for_next.sh

  # BL-1560 swarm-stamp-missing-script-path-07
  # Undecided means: state is neither certified nor waived, human_decision
  # is null and decided_at is null. The row moves pending -> stamp-open the
  # moment the mint links the stamp ticket, so the literal state pending is
  # unreachable from inside the parcel (BL-1560 cleaner D1, 2026-09-14).
  Scenario: the stamp leaves the certification decision to the human
    When the review parcel completes
    Then the ledger row for the reviewed commit carries no human decision
