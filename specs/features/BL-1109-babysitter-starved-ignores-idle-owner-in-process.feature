# mutation-stamp: sha256=f3c33df6ab48290e25b8c44a7cac6f9fec04a8a9a8531b0b48f09ffe70d82bee
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T11:09:44.320435939Z","feature_name":"BL-1109 babysitter STARVED counts a live in_process claim as motion even when the owner pane is idle","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1109-babysitter-starved-ignores-idle-owner-in-process.feature","background_hash":"1348b5a3946572977a61dc0fd159dd7cb58d01b9dc2554bb9720edc00a2c5010","implementation_hash":"unknown","scenarios":[{"index":0,"name":"starved motion depends on whether a live in_process claim exists","scenario_hash":"bb7324e07b9636b60479ebd29535c388ddfc1bb7de6190e461d3e055218ca4df","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-24T11:06:12.197756199Z"},{"index":2,"name":"in_process discovery sees the same mailbox shapes stuck-in-process already sees","scenario_hash":"d1c04822c2caf1a1acb86588b12c91305ec31a475adb1ac3f0dc2ae3f29592c6","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-24T11:06:12.197756199Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1109 babysitter STARVED counts a live in_process claim as motion even when the owner pane is idle
  babysitterd's swarm-starved check (check 10) only treats an in_process
  claim as motion when the owning pane is classified busy. A Cursor
  Thinking pause, a rotate gap, or a follow-up bar makes the owner look
  idle for two sweeps while parcels still sit in in_process — the CRIT
  then fires and claims "zero pending/in-process parcels" even though
  claims exist.

  Measured 2026-08-23 on cursor-mono-router: resident QA held BL-1099 in
  worktree in_process and documenter held BL-1087; both panes sampled
  idle; STARVED CRIT fired. Distinct from BL-807 (stuck-in-process WARN
  ownership); this is the starved predicate and its CRIT copy.

  Background:
    Given a swarm with at least one active ticket and no control pause

  # BL-1109 starved-in-process-motion-01
  Scenario Outline: starved motion depends on whether a live in_process claim exists
    Given the mailbox state is "<mailbox>"
    And every pane is idle
    When babysitterd evaluates the swarm-starved check for two consecutive idle sweeps
    Then the swarm-starved verdict is "<verdict>"

    Examples:
      | mailbox                                      | verdict   |
      | one non-abandoned in_process claim, owner idle | clear   |
      | no pending and no in_process claims            | starved |

  # BL-1109 starved-crit-copy-04
  Scenario: when in_process claims exist the CRIT never claims the mailbox is empty
    Given an in_process handoff whose owning role's pane is idle this sweep
    When the starved finding text is composed for that sweep
    Then the text does not claim zero pending or in-process parcels

  # BL-1109 starved-in-process-glob-03
  Scenario Outline: in_process discovery sees the same mailbox shapes stuck-in-process already sees
    Given an in_process handoff at "<path-shape>"
    When babysitterd gathers in-process claims for the starved check
    Then that handoff is among the claims

    Examples:
      | path-shape                                      |
      | a role worktree inbox/in_process/*.handoff      |
      | a nested worktree **/inbox/in_process/*.handoff |
      | a batch_* in_process directory handoff          |
