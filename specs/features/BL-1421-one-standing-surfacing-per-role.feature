# mutation-stamp: sha256=3181d4507d14162a9d326ccd0d7da7f2f51de5839c5237dea70b8f1cfa59dde5
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T09:21:05.709915889Z","feature_name":"BL-1421 The post-QA branch sweep tells a role once per surfacing and wakes only a role that is not mid-parcel","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1421-one-standing-surfacing-per-role.feature","background_hash":"01df2b2c6d75713fc899fd7524132fc96d36e82342bd5b7c4798bd1de91e3d88","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a role already told for a reason is told nothing when a newer commit lands and it has not caught up","scenario_hash":"2b9531c3437decb5249f2c2b7901571294ebb58a435d8e01cf7e3f3e40b9979e","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-05T09:21:05.709915889Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1421 The post-QA branch sweep tells a role once per surfacing and wakes only a role that is not mid-parcel

  BL-1361 made the post-QA branch sweep tell a role whose branch it could
  not settle, and, by the human's ruling, wake it only for a dirty worktree.
  Its state resets whenever origin/main gains a new landed commit
  (normalize-state-for-landed), and decide-role classes a role as
  dirty-worktree before it looks at in_process work. A role mid-parcel is
  dirty by definition, and main landed 103 commits on 2026-09-05, so the
  six worktree roles were told and woken 539 times that day (75 to 102
  each) with "branch behind <sha>: dirty worktree - merge up". Those notes
  queued twenty deep in the coder's inbox and were cleared in bursts of
  blind completions that swept real Work dispatches out with them
  (BL-1384, four times).

  This feature is that a surfacing is standing: a role told it is behind is
  not told again for a newer landed commit until it has caught up to the
  commit it was told about; that a role holding in_process work is surfaced
  as in-process work and never woken, because its dirtiness is the parcel;
  and that BL-1361's contract, every reason told and never twice for the
  same standing surfacing, holds unchanged.

  Background:
    Given a fixture sweep state and a role whose branch is behind origin/main

  # BL-1421 a-standing-surfacing-is-not-retold-per-landed-commit-01
  Scenario Outline: a role already told for a reason is told nothing when a newer commit lands and it has not caught up
    Given the role was told it is behind commit A for <reason>
    And commit B lands on origin/main while the role's HEAD still lacks A
    When the sweep runs
    Then the role is told nothing and woken nothing

    Examples:
      | reason             |
      | a dirty worktree   |
      | in_process work    |
      | a divergent branch |

  # BL-1421 catching-up-clears-the-surfacing-02
  Scenario: a role that caught up to the commit it was told about is told once more when it falls behind again
    Given the role was told it is behind commit A and its HEAD now contains A
    And commit B lands on origin/main and the role's worktree is dirty again
    When the sweep runs
    Then the role is told once that it is behind B

  # BL-1421 in-process-work-is-never-woken-03
  Scenario: a role holding in_process work is surfaced as in-process work, told once, and not woken
    Given the role holds an in_process parcel and its worktree is dirty from that work
    When the sweep runs
    Then the role is told its branch is behind for in_process work
    And the role is not woken

  # BL-1421 the-2026-09-05-replay-tells-once-04
  Scenario: replaying 103 landed commits against a role that never merges tells it exactly once
    Given a replay of 103 successive landed commits with the role dirty and behind throughout
    When the sweep runs after each landed commit
    Then the role is told exactly once and woken exactly once
