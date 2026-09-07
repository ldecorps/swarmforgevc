# mutation-stamp: sha256=f85fc3c66427d99e9c44fc23461993035e235fba80fb3ddad787cb9da73e1428
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-07T22:39:58.923292127Z","feature_name":"BL-1470 The land step's bounce check reads the store where bounces are written, from any worktree","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1470-the-bounce-check-reads-the-store-where-bounces-are-written.feature","background_hash":"60ca9915fc105dd3b063e31b3e84071d445b6b6842d9a26b2f05ddb9810c41d7","implementation_hash":"unknown","scenarios":[{"index":3,"name":"a store that cannot be read in either root blocks rather than passes","scenario_hash":"b1c9a64ee66a76cf0591897f26614befbca5bd806a3b3b4d384a32dce12a376b","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-07T22:39:58.923292127Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1470 The land step's bounce check reads the store where bounces are written, from any worktree

  BL-1466 gave the land step a bounce-aware sibling state: a sibling whose
  latest bounce is newer than its latest handoff is blocking and named.
  It reads .swarmforge/bounces/<YYYY-MM>.jsonl under the root its caller
  passes, and the land CLI's default root is the calling worktree, where
  no such store exists: record-bounce.js writes under the master checkout,
  the shared target root that git rev-parse --git-common-dir names. So in
  every ordinary invocation, land_step_cli.bb with no third argument and
  land_main_publish.sh's own call, the check finds no directory, answers
  "never bounced", and the protection minted the same morning is inert.
  QA found it verifying BL-1463 the same afternoon: nil from the QA
  worktree, the correct bounced state only with the master root passed by
  hand. This feature is that the check reads the store where bounces are
  written whoever asks, that a record in the caller's own store still
  counts, and that the answer never depends on which checkout asked. Every
  scenario runs against a fixture repository under mkdtemp with its own
  origin and its own linked worktree (BL-1390).

  Background:
    Given a fixture repository with an origin, a linked role worktree of that repository, a landing ticket, and an approved sibling ticket sharing a path

  # BL-1470 a-bounce-in-the-shared-store-blocks-from-a-linked-worktree-01
  Scenario: a bounce recorded in the shared root's store blocks the sibling when the land step is asked from the linked worktree
    Given a bounce record for the sibling under the shared root's .swarmforge/bounces naming a commit reachable from the tip
    When the land step CLI plans the landing ticket's tip from inside the linked worktree with no explicit root
    Then the sibling is reported as blocking, naming the bounce and its commit

  # BL-1470 the-answer-is-the-same-from-the-master-root-02
  Scenario: the same tip asked from the master checkout gets the same answer
    Given a bounce record for the sibling under the shared root's .swarmforge/bounces naming a commit reachable from the tip
    When the land step CLI plans the landing ticket's tip from the master checkout
    Then the sibling is reported as blocking, naming the bounce and its commit

  # BL-1470 a-record-in-the-callers-own-store-still-counts-03
  Scenario: a bounce recorded under the calling worktree's own store also blocks
    Given a bounce record for the sibling under the linked worktree's own .swarmforge/bounces and none under the shared root
    When the land step CLI plans the landing ticket's tip from inside the linked worktree with no explicit root
    Then the sibling is reported as blocking, naming the bounce and its commit

  # BL-1470 an-unreadable-store-in-either-root-blocks-04
  Scenario Outline: a store that cannot be read in either root blocks rather than passes
    Given the bounce store under <root> is unreadable
    When the land step plans the landing ticket's tip from inside the linked worktree
    Then the sibling's approval state is unreadable and blocking, naming the store

    Examples:
      | root                 |
      | the shared root      |
      | the linked worktree  |

  # BL-1470 no-store-anywhere-is-never-bounced-05
  Scenario: no bounce store under either root is a real never-bounced answer
    Given no .swarmforge/bounces directory under the shared root or the linked worktree
    When the land step plans the landing ticket's tip from inside the linked worktree
    Then the sibling's approval state is exactly what BL-1375 gives it
