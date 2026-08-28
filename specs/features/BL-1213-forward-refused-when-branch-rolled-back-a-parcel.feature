# mutation-stamp: sha256=0cd53113c501dcb6408e8fb4848905da9c3ca7b6682d73a46823c9877016fcf0
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-28T01:55:45.307157377Z","feature_name":"BL-1213 a forward is refused when the branch rolled back an accepted parcel's landed content","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1213-forward-refused-when-branch-rolled-back-a-parcel.feature","background_hash":"5b15bc516381da5add274bf13b5c96b4aed7d5e162053d19d7451e23bd2e726f","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the tip's content and the branch's revert history decide the send","scenario_hash":"1d33cfbc8b62414b086823566dac71d8218415fdc3ce2c1f560561ceef63d042","mutation_count":12,"result":{"Total":12,"Killed":12,"Survived":0,"Errors":0},"tested_at":"2026-08-28T01:55:45.307157377Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1213 a forward is refused when the branch rolled back an accepted parcel's landed content

  A role branch can reach its tip holding the content a path had BEFORE an
  accepted parcel commit changed it, with nothing anywhere reading as wrong.
  A bulk restore-from-sibling authors that rollback for hundreds of paths at
  once, so `git log` shows a repair rather than a revert, and BL-1098's
  silent-revert predicate excuses it by construction: its first conjunct is
  `(not tip-matches-newest-authoring?)`, and after a bulk restore the tip
  matches its newest authoring commit exactly. The deletion-diff quarantine
  lift is blind for a second, independent reason - the path is present, only
  its content is stale, and the sibling it is compared against was the source
  of the stale content.

  Nothing stops such a branch forwarding the loss at the hop where it happens.
  The one gate that can see it - the pre-QA required_wiring check - sits at the
  documenter-to-QA hop and fires only for paths a ticket happened to declare,
  so the loss travels five stages first and then surfaces as "wiring absent"
  rather than "this branch rolled your parcel back". On 2026-08-27
  `e52261521` rolled BL-592's seven landed paths back to byte-identical
  pre-parcel content on the coder, architect and hardener branches at once;
  BL-1188, BL-1189 and BL-592 were then rediscovered one file at a time, by
  hand, over a day of review.

  This gate runs at the one place every hop crosses - the `git_handoff` send -
  and answers from git objects and the recorded parcel commit alone. It
  refuses only on a positive finding. The two legal ways a path may hold
  pre-parcel content are never refused: a BL-490/BL-495 bounce revert on this
  branch, and later work that authored genuinely different content.

  Background:
    Given an active ticket whose accepted parcel commit changed a path on this branch
    And a role holding that branch, ready to hand off

  # BL-1213 forward-refused-when-branch-rolled-back-a-parcel-01
  Scenario Outline: the tip's content and the branch's revert history decide the send
    Given the branch tip holds <tip_content> for that path
    And a revert of the parcel commit on this branch is <branch_revert>
    When the role sends the git_handoff
    Then the send is <outcome>

    Examples:
      | tip_content   | branch_revert | outcome |
      | pre-parcel    | absent        | refused |
      | pre-parcel    | present       | allowed |
      | parcel        | absent        | allowed |
      | later-content | absent        | allowed |

  # BL-1213 forward-refused-when-branch-rolled-back-a-parcel-02
  Scenario: the refusal names every rolled-back path and the parcel commit it came from
    Given the branch tip holds pre-parcel content for three of the paths that parcel commit changed
    When the role sends the git_handoff
    Then the send is refused
    And the refusal names all three paths
    And the refusal names the parcel commit whose content they rolled back

  # BL-1213 forward-refused-when-branch-rolled-back-a-parcel-03
  Scenario: a commit that authored the rollback does not excuse it
    Given a bulk restore commit on this branch is the newest commit authoring that path
    And the branch tip holds pre-parcel content for that path
    When the role sends the git_handoff
    Then the send is refused

  # BL-1213 forward-refused-when-branch-rolled-back-a-parcel-04
  Scenario: the gate warns and sends when it cannot read the facts it needs
    Given the parcel commit recorded for the ticket cannot be read
    When the role sends the git_handoff
    Then the send is allowed
    And a warning names the ticket whose parcel commit could not be read

  # BL-1213 forward-refused-when-branch-rolled-back-a-parcel-05
  Scenario: a handoff that forwards no commit is untouched
    Given the branch tip holds pre-parcel content for that path
    When the role sends a note instead of a git_handoff
    Then the send is allowed
    And the gate records no finding
