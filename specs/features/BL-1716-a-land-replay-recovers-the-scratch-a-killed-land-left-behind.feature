Feature: BL-1716 A land replay recovers the scratch a killed land left behind

  The land step builds every land in a scratch worktree and branch named
  by the ticket and the cited commit, and removes both on every exit path
  it reaches. A land killed mid-replay reaches none, so the worktree and
  the branch survive, and the next land of the same ticket and commit
  cannot create its own: it escalates as if an adjudication were needed,
  without git's reason, and only the attempt after it succeeds.
  test_bl1366_land_is_one_command.sh has been red on main for exactly this.
  This feature is that a replay clears a scratch whose run is dead before
  building its own, that it never touches a scratch a live run owns, and
  that a refusal says why.

  Background:
    Given a fixture origin with an approved parcel for fixture ticket BL-9716

  # BL-1716 a-dead-runs-scratch-is-cleared-01
  Scenario: a scratch worktree and branch left by a run that is no longer alive are cleared and the replay succeeds
    Given the parcel's replay worktree and scratch branch exist, recorded to a run that is no longer alive
    When the land step replays the parcel
    Then it builds the tip-pure commit off origin/main
    And no replay worktree for BL-9716 remains registered or on disk

  # BL-1716 a-live-runs-scratch-is-left-alone-02
  Scenario: a scratch owned by a run that is still alive is left exactly as it was
    Given the parcel's replay worktree and scratch branch exist, recorded to a run that is still alive
    When the land step replays the parcel
    Then the replay refuses naming the live run that owns the scratch
    And that worktree and branch are unchanged

  # BL-1716 a-create-failure-names-gits-reason-03
  Scenario: a worktree the replay cannot create is refused with git's own reason
    Given the parcel's replay worktree path is occupied by a plain file
    When the land step replays the parcel
    Then the replay refuses with a reason that carries git's own error text

  # BL-1716 a-recordless-scratch-past-the-age-bound-is-cleared-04
  Scenario: a scratch with no owner record (predating this fix) past the stale-scratch age bound is cleared
    Given the parcel's replay worktree and scratch branch exist with no owner record
    And the stale-scratch age bound is 0 hours
    When the land step replays the parcel
    Then it builds the tip-pure commit off origin/main
    And no replay worktree for BL-9716 remains registered or on disk

  # BL-1716 a-recordless-scratch-still-young-is-refused-unestablished-05
  Scenario: a scratch with no owner record and still within the age bound is refused with no owner named
    Given the parcel's replay worktree and scratch branch exist with no owner record
    When the land step replays the parcel
    Then the replay refuses naming no owner at all
    And the worktree and branch remain, still with no owner record

  # BL-1716 a-branch-only-leftover-with-no-directory-is-cleared-06
  Scenario: a branch surviving a past success, with no directory and a dead owner, is cleared and the replay succeeds
    Given the parcel's replay branch exists with no directory, recorded to a run that is no longer alive
    When the land step replays the parcel
    Then it builds the tip-pure commit off origin/main
    And no replay worktree for BL-9716 remains registered or on disk
