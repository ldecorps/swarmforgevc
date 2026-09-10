Feature: BL-1504 Stamp-off review of the fresh-target wake dedup hotfix

  BL-848 review-only certification of landed commit 6e05b02dd3 (2026-09-09).
  The wake dedup sidecar suppressed on unchanged-mailbox and cooldown with
  no notion of WHICH pane it last woke, so a documenter seat rotated with
  its parcel still in in_process inherited the old pane's suppression and
  sat idle for 2h28m; and the chase sweep consumed the per-sweep resident
  wake budget before the dedup gate decided, so one role's suppressed wake
  starved every other role sharing the resident pane. The hotfix records
  the wake pane's root pid as lastTargetEpoch and forces one inject for an
  epoch the sidecar has not woken, and consumes the budget only when a
  wake landed.

  These scenarios confirm or refute what landed; none may rewrite it, and
  none writes a certify or waive decision into backlog/hotfix-ledger.yaml -
  only a recorded human decision does that.

  # BL-1504 swarm-stamp-wake-dedup-fresh-target-01
  Scenario Outline: a wake for a seat incarnation the sidecar has not woken is injected once, then deduplicated
    Given a role whose mailbox is unchanged since its last recorded wake
    And the wake pane's seat epoch is <epoch> relative to the sidecar
    When the daemon's startup notify runs for that role
    Then the wake is <outcome>

    Examples:
      | epoch        | outcome                                |
      | the same     | suppressed as unchanged-mailbox        |
      | a new one    | injected with reason fresh-target      |
      | blank        | suppressed as unchanged-mailbox        |

  # BL-1504 swarm-stamp-wake-dedup-fresh-target-02
  Scenario: a legacy sidecar reads back with a blank epoch and decides as before the hotfix
    Given a wake dedup sidecar written before the hotfix, carrying no lastTargetEpoch
    When the sidecar is read
    Then it reads back with a blank epoch
    And an unchanged mailbox is still suppressed

  # BL-1504 swarm-stamp-wake-dedup-fresh-target-03
  Scenario: a suppressed wake leaves the per-sweep resident budget for the next role
    Given two roles sharing the resident pane, the first with an unchanged mailbox and the second with a new parcel
    When one chase sweep runs
    Then the first role's wake is suppressed
    And the second role's wake lands in the same sweep

  # BL-1504 swarm-stamp-wake-dedup-fresh-target-04
  Scenario: the stamp leaves the certification decision to the human
    When the review parcel completes
    Then the ledger row for the reviewed commit still reads "pending"
