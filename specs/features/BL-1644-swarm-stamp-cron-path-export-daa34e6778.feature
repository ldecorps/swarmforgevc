Feature: BL-1644 Stamp-off review of the cron PATH export hotfix

  BL-848 review-only certification of landed commit daa34e6778 (2026-09-18).
  Cron runs its jobs with a bare PATH that lacks the directories where bb,
  claude and tmux live on this host, so on the morning of 2026-09-18 the
  day-shift launcher's rotate step failed with exit 127 (bb not found). The
  hotfix puts the PATH export start-swarm.sh already carries at the top of
  the two tracked entrypoints of the bedtime chain, finish-shift and
  wait_for_expedite_then_bedtime.sh, before either shells out.

  These scenarios confirm or refute what landed; none may rewrite it, and
  none writes a certify or waive decision into backlog/hotfix-ledger.yaml -
  only a recorded human decision does that.

  Background:
    Given a fixture home directory carrying executable stubs for bb, tmux and claude under its .local/bin

  # BL-1644 swarm-stamp-cron-path-export-01
  Scenario Outline: under cron's bare PATH the script's own prelude makes bb, tmux and claude resolve before it shells out
    Given the tracked entrypoint <script>
    When its prelude up to and including the PATH export is sourced under an environment holding only HOME and a bare PATH
    Then bb, tmux and claude each resolve to the stub under the fixture home
    And the export line precedes the first invocation of bb, tmux, claude, node or npx in the file

    Examples:
      | script                                              |
      | finish-shift                                        |
      | swarmforge/scripts/wait_for_expedite_then_bedtime.sh |

  # BL-1644 swarm-stamp-cron-path-export-02
  Scenario: every tracked bash entrypoint the installed crontab reaches carries the export, and the census is pinned
    Given a fixture copy of the installed crontab lines
    When the tracked bash entrypoints cron reaches directly or through the bedtime chain are derived
    Then the derived set has exactly 3 members and includes finish-shift and swarmforge/scripts/daemon_log_freshness_check.sh
    And each member carries the PATH export before its first shell-out

  # BL-1644 swarm-stamp-cron-path-export-03
  Scenario: the review never records a certification decision
    When the hotfix ledger row for daa34e6778 is read on the parcel commit
    Then its state is neither certified nor waived
    And its human decision is null
