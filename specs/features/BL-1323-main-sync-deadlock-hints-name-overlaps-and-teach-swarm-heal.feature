Feature: main-sync deadlock hints name overlapping paths and teach ./swarm heal

  # BL-1323 stamp-off for landed hotfix 9c94735f03 (BL-848 certification
  # ledger). The behaviour below is ALREADY in production — this feature
  # certifies it through the full gate stack rather than re-specifying a
  # rebuild. Before this hotfix, babysitterd's CRIT gather shelled out with
  # `sh! {:dir ...} "git" "status" "--porcelain"` — a call shape that
  # `bb`'s `sh!` does not accept (it spawned a literal argument "{:dir",
  # which fails), so the exception was swallowed and the CRIT/escalation
  # fell open to a generic "inspect git status" hint naming no paths at all.
  # The Telegram/email deadlock alert had the same gap: it told the operator
  # to "wait for BL-891 reconcile" without naming a single overlapping path
  # or an actionable next step.

  Background:
    Given a main-sync deadlock is active with reason "dirty"

  # BL-1323 marker-overlap-preferred-over-recompute-01
  Scenario: babysitter prefers the deadlock marker's own overlapping paths when present
    Given the main-sync deadlock marker was tripped with overlapping paths already recorded on it
    When babysitterd gathers the main-sync-deadlock finding
    Then the finding's overlapping paths are exactly the ones recorded on the marker
    And no git status is shelled out to recompute them

  # BL-1323 recompute-uses-dash-c-not-broken-dir-option-02
  Scenario: babysitter recomputes overlapping paths from git when the marker has none
    Given the main-sync deadlock marker was tripped with reason "dirty" and no overlapping paths recorded
    When babysitterd gathers the main-sync-deadlock finding
    Then babysitterd runs git status against the master checkout using the -C flag
    And the finding's overlapping paths reflect the real dirty and merge-changed overlap

  # BL-1323 handoffd-persists-overlap-at-trip-time-03
  Scenario: handoffd persists overlapping paths on the deadlock marker at trip time
    Given a main-sync deadlock trips for the first time in this incident
    When handoffd writes the deadlock marker
    Then the marker's overlapping_paths field holds the dirty and merge-changed overlap computed at trip time

  # BL-1323 hint-names-paths-and-teaches-heal-04
  Scenario Outline: the operator hint names overlapping paths and teaches ./swarm heal
    Given <count> overlapping paths
    When the operator-facing deadlock hint is built
    Then the hint <shows>
    And the hint ends with a "./swarm heal" instruction

    Examples:
      | count | shows                                                    |
      | 0     | a fallback instruction to inspect git status              |
      | 3     | all 3 paths by name                                        |
      | 12    | the first 8 paths by name and a "(+4 more)" remainder note |

  # BL-1323 telegram-alert-reuses-actionable-hint-body-05
  Scenario: the Telegram/email deadlock alert reuses the same actionable hint text
    Given a main-sync deadlock trips with overlapping paths recorded
    When the deadlock alert is sent to the operator
    Then the alert body names the overlapping paths and includes "./swarm heal"
    And the alert body is no longer the generic "wait for BL-891 reconcile" message alone
