# mutation-stamp: sha256=6c881830fae30480e1829d08d49c89e42a4bed011a95458cabf156733594d60a
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-20T15:07:24.787847Z","feature_name":"BL-982 a pipeline stage can host a second seat, booting with its own identity and its own model","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-982-second-seat-of-a-stage-boots-with-its-own-model.feature","background_hash":"fe673a252be77acfec0bdbe9833770b222e6ce7e00eaa814b8f14ffd691207cf","implementation_hash":"unknown","scenarios":[{"index":4,"name":"identity collisions are still refused at parse","scenario_hash":"0627bb9e76b842e1ef39af141d67cc2b361cfded681d9ee7419baa63f440d685","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-20T15:07:24.787847Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-982 a pipeline stage can host a second seat, booting with its own identity and its own model

  Today swarmforge.sh refuses a pack that names one stage twice ("Duplicate role
  '$role'"), and every identity a running role needs - tmux session, worktree and
  branch family, launch script, remote-control name, prompt file - is derived from
  that one role name. Per-seat model needs no new machinery: each window line
  already carries its own --model/--effort through extra_args. So splitting SEAT
  identity from STAGE identity is the whole of this slice, and "a Sonnet coder and
  a Fable coder in one swarm" follows from it.

  This slice stops at identity. The second seat boots and is inert - nothing is
  delivered to it and it claims nothing - until the mailbox slice lands.

  Background:
    Given a pack config declaring the pipeline stages

  # BL-982 second-seat-boots-with-its-own-model-01
  Scenario: a pack naming two seats of one stage parses instead of hard-failing
    Given the pack declares two seats for one stage, each with its own worktree
    When the pack config is parsed
    Then the parse succeeds
    And both seats are reported as seats of that one stage

  # BL-982 second-seat-boots-with-its-own-model-02
  Scenario: each seat is provisioned under its own identity
    Given the pack declares two seats for one stage, each with its own worktree
    When the swarm is provisioned from that pack
    Then each seat has its own session, worktree and launch script
    And both seats resolve their role prompt from the one stage

  # BL-982 second-seat-boots-with-its-own-model-03
  Scenario: two seats of one stage run different models
    Given the pack declares two seats for one stage, each with its own worktree
    And the two seats declare different models on their own window lines
    When the swarm is provisioned from that pack
    Then each seat is launched with the model its own window line declared

  # BL-982 second-seat-boots-with-its-own-model-04
  Scenario: a single-seat pack is provisioned exactly as before
    Given the pack declares one seat for every stage
    When the swarm is provisioned from that pack
    Then every session, worktree, launch script and prompt path is unchanged from before this slice

  # BL-982 second-seat-boots-with-its-own-model-05
  Scenario Outline: identity collisions are still refused at parse
    Given the pack declares <collision>
    When the pack config is parsed
    Then the parse fails naming the collision

    Examples:
      | collision                                    |
      | two seats of one stage sharing a seat id     |
      | two seats of one stage sharing a worktree    |

  # BL-982 second-seat-boots-with-its-own-model-06
  Scenario: the second seat is inert until the mailbox slice lands
    Given the pack declares two seats for one stage, each with its own worktree
    When a parcel addressed to that stage is delivered
    Then the second seat is not delivered the parcel
    And the second seat claims nothing
