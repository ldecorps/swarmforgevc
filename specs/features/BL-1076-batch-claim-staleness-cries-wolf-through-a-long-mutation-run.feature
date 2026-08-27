Feature: BL-1076 a batch claim is judged stale only when its owner shows no work
  The batch-claim-progress observer (BL-678) surfaces a coordinator note when a
  batch role's worktree HEAD has not moved for the stale threshold. It reads one
  flat 20-minute threshold for every batch role and looks only at HEAD, so a
  hardener mid-Stryker - an hour of legitimate work before the first commit,
  with edits sitting uncommitted in the worktree - is surfaced as suspect.

  Measured on this host 2026-08-22: the hardener claimed a three-parcel batch at
  20:20:18Z, committed its merges at 20:20:44Z, and was still working with
  `M extension/test/boyScoutRun.test.js` uncommitted when the sweep surfaced all
  three parcels as suspect at 20:40:46Z and again at 21:10:48Z - six false notes
  to the coordinator in fifty minutes, none of them describing anything wrong.

  Two signals the observer already had available make the difference: the owning
  role (BL-528's task-mode ladder already grants `hardender` a 90-minute window
  for exactly this reason) and whether the owner's worktree is dirty (BL-528
  already treats uncommitted work as progress). This slice gives the batch
  observer both. It changes only which observations are surfaced; the observer
  still never re-forwards, re-delivers, or otherwise touches a parcel.

  Background:
    Given a batch role holds a claimed parcel whose worktree HEAD has not moved since its last recorded progress

  # BL-1076 batch-claim-visible-work-01
  Scenario Outline: Staleness is judged against the owning role's own tolerance and its visible work
    Given the owning role is <role>
    And its worktree is <worktree>
    When <minutes> minutes have passed since the last recorded progress
    Then the observation is <observation>

    Examples:
      | role      | worktree | minutes | observation             |
      | hardender | clean    | 25      | silent                  |
      | hardender | clean    | 95      | stale-suspect           |
      | cleaner   | clean    | 25      | stale-suspect           |
      | hardender | dirty    | 95      | suppressed-visible-work |
      | cleaner   | dirty    | 25      | suppressed-visible-work |

  # BL-1076 batch-claim-visible-work-02
  Scenario: A genuine stale-suspect still reaches the coordinator as one note
    Given a claimed parcel whose observation is stale-suspect
    When the chase sweep runs
    Then the coordinator receives one suspect note naming the parcel and its progress age
    And the parcel remains claimed in in_process with no copy in inbox new

  # BL-1076 batch-claim-visible-work-03
  Scenario: A suppressed observation is silent to the coordinator, never silent in the record
    Given a claimed parcel whose observation is suppressed-visible-work
    When the chase sweep runs
    Then no suspect note is sent to the coordinator
    And the sweep records the suppression against the parcel id with its reason

  # BL-1076 batch-claim-visible-work-04
  Scenario: A commit clears the suspicion for every parcel in the same batch claim
    Given the owning role is hardender
    And 95 minutes have passed since the last recorded progress
    When the role's worktree HEAD advances and the chase sweep runs
    Then every parcel in that batch claim records the new commit as its last progress
    And the observation is silent

  # BL-1076 batch-claim-visible-work-05
  Scenario Outline: An operator retunes one role, and an unusable setting degrades to the built-in tolerance
    Given the configured hardener batch stale threshold is <configured>
    And the owning role is hardender
    And its worktree is clean
    When 5 minutes have passed since the last recorded progress
    Then the observation is <observation>

    Examples:
      | configured | observation   |
      | 2          | stale-suspect |
      | absent     | silent        |
      | 0          | silent        |
