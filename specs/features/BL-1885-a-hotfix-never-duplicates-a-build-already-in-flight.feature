# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-10-10T04:51:58.832642235Z","feature_name":"BL-1885 A hotfix never duplicates a build already in flight","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1885-a-hotfix-never-duplicates-a-build-already-in-flight.feature","background_hash":"7c000c3b0aa0f925ba47f46a4f362d95ff38b339c5ec3507bc1bfc639e79ea29","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: BL-1885 A hotfix never duplicates a build already in flight

  A hotfix commit carries "Hotfix-Certification: pending" and names the
  ticket that becomes its stamp-off ("Stamp-off: BL-nnnn"). On 2026-10-02
  the specifier hotfixed BL-1877 while the coder's own build of it,
  7613ab0006, sat unclaimed in QA's queue as parcel 002306; it misread the
  build's subject as the ticket's mint commit. The duplicate then leaked
  into another ticket's lineage and had to be recorded as abandoned by
  hand. The commit-msg chain now refuses a hotfix commit whose stamp-off
  ticket already has a build in flight, unless the message names that
  build as superseded.

  Background:
    Given a fixture repository with the commit-msg guard chain and an active ticket BL-9001

  # BL-1885 a-live-parcel-refuses-the-hotfix-01
  Scenario: a hotfix for a ticket with a live parcel in a role's mailbox is refused
    Given a role's mailbox holds a git_handoff parcel for BL-9001 at a commit not on main
    When a hotfix commit names BL-9001 as its stamp-off
    Then the commit is refused naming the parcel and its commit

  # BL-1885 an-unlanded-build-refuses-the-hotfix-02
  Scenario: a hotfix for a ticket with an unlanded build on a role branch is refused
    Given a role branch holds a commit whose subject names BL-9001 and that is not on main
    When a hotfix commit names BL-9001 as its stamp-off
    Then the commit is refused naming that commit

  # BL-1885 a-named-supersede-lets-the-hotfix-land-03
  Scenario: a hotfix that names the in-flight build as superseded is accepted
    Given a role's mailbox holds a git_handoff parcel for BL-9001 at a commit not on main
    When a hotfix commit names BL-9001 as its stamp-off and that commit as superseded
    Then the commit is accepted

  # BL-1885 nothing-in-flight-lets-the-hotfix-land-04
  Scenario: a hotfix for a ticket with no build in flight is accepted
    Given no mailbox holds a parcel for BL-9001 and no role branch holds an unlanded BL-9001 commit
    When a hotfix commit names BL-9001 as its stamp-off
    Then the commit is accepted
