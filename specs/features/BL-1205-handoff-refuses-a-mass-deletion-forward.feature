# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-28T02:07:57.657510687Z","feature_name":"a git_handoff whose merge into the recipient's branch would mass-delete tracked files is refused before it is sent","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1205-handoff-refuses-a-mass-deletion-forward.feature","background_hash":"b8ffbd94102d4622a06346f074f988f8a5e409b6f062d6e84765f28fafee3a0f","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: a git_handoff whose merge into the recipient's branch would mass-delete tracked files is refused before it is sent

  # BL-1205 (epic swarm-reliability). 2026-08-27: refs/heads/swarmforge-architect
  # was collapsed to 79 tracked paths by 200 test-fixture commits (subjects
  # `init`, `seed`, `fixture: initial`, all authored `t <t@t>` at the identical
  # second 19:56:03 +0100). Each fixture commit is a ~9,700-file deletion
  # relative to the real tree, and every later merge from cleaner honoured
  # those deletions the ordinary way — one side deleted, other side untouched,
  # no conflict, no marker. Simulated at the time:
  # `git merge-tree --write-tree swarmforge-hardender swarmforge-architect`
  # yields a tree of 93 paths against the hardener's 9,773. One forward from
  # that branch deletes 9,680 tracked files and is then four ordinary hops
  # from landing on main. Evidence: backlog/evidence/
  # swarmforge-architect-branch-tree-collapse-20260827.md.
  #
  # swarm_handoff.bb already carries four blocking gates, but none of them
  # sees this: pre_qa_gate_lib/gate-armed? arms only for a git_handoff whose
  # `to` includes QA, and it keys on ticket-id evidence, so a mass deletion
  # tied to no ticket id crosses the architect -> hardener hop, which has no
  # gate at all. This is the sender-side backstop for the BL-571 / BL-954 /
  # BL-958 failure mode.

  Background:
    Given a role is sending a git_handoff naming a commit on its own branch

  # BL-1205 mass-deletion-forward-is-refused-01
  Scenario: A forward whose merge would remove most of the recipient's tracked files is refused
    Given merging the named commit into the recipient's branch would remove far more tracked paths than the threshold allows
    When the role sends the git_handoff
    Then the send is refused
    And the refusal names how many tracked paths the merge would remove

  # BL-1205 ordinary-deletions-still-forward-02
  Scenario: A forward that deletes a handful of files is sent normally
    Given merging the named commit into the recipient's branch would remove fewer tracked paths than the threshold allows
    When the role sends the git_handoff
    Then the send succeeds

  # BL-1205 every-hop-is-guarded-not-only-the-qa-edge-03
  Scenario Outline: The guard arms on every hop, whatever role the parcel is addressed to
    Given merging the named commit into the recipient's branch would remove far more tracked paths than the threshold allows
    When the role sends the git_handoff to <recipient>
    Then the send is refused

    Examples:
      | recipient  |
      | cleaner    |
      | architect  |
      | hardender  |
      | documenter |
      | QA         |

  # BL-1205 unreadable-recipient-branch-warns-never-blocks-04
  Scenario: The guard cannot read the recipient's branch, so it warns and lets the send through
    Given the recipient's branch cannot be read
    When the role sends the git_handoff
    Then the send succeeds
    And a warning names the branch that could not be read

  # BL-1205 note-is-not-gated-05
  Scenario: A note carries no commit, so the guard does not apply to it
    Given the role is sending a note rather than a git_handoff
    When the role sends it
    Then the send succeeds
