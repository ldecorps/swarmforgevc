# mutation-stamp: sha256=fe68ae28560951207f1216fb3f6c006c540d58b64d027bbe2a0a452ee81a4457
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T07:39:04.474871781Z","feature_name":"A control pause is visible from every checkout, not only from master","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1106-a-pause-is-visible-from-every-checkout.feature","background_hash":"793de2bf79d06d2d8e5999fec66e1b60f821dcd730787b5f296e31140d770689","implementation_hash":"unknown","scenarios":[{"index":0,"name":"The pause dimension resolves identically from every checkout","scenario_hash":"0f05605ee36a1a1bc8c4fbe8b1be9d021f6d0ae0c6ff74bb86d6eab84f0e52d0","mutation_count":18,"result":{"Total":18,"Killed":18,"Survived":0,"Errors":0},"tested_at":"2026-08-24T07:39:04.474871781Z"}]}
# acceptance-mutation-manifest-end

Feature: A control pause is visible from every checkout, not only from master
  BL-966 established that the effective-depth resolution must give the same
  answer from the master checkout and from any linked worktree, and fixed the
  CONFIG half by resolving swarm-identity at the repository's master checkout.
  The PAUSE half was left reading the caller's own root. Worktrees carry no
  .swarmforge/operator/control-pause.json - the file is gitignored local runtime
  state, so it never travels - and an absent marker reads as "not paused".

  With a pause active, master resolves 0 and a worktree resolves the full cap.
  Both promotion entry points derive their root from `git rev-parse
  --show-toplevel`, so a promote invoked from a worktree walks straight past a
  human's explicit hold.

  BL-966's own worktree scenario cannot catch this: its fixture writes an
  identity and a pack conf but never a pause marker, so the pause dimension is
  identical on both sides and the assertion holds vacuously. The fixtures here
  write a real marker.

  Background:
    Given a scratch git repository whose master checkout carries a swarm-identity naming a pack conf with cap 7
    And a linked worktree of that repository

  # BL-1106 pause-visible-everywhere-01
  Scenario Outline: The pause dimension resolves identically from every checkout
    Given the master checkout carries <marker>
    When the depth CLI runs against the <checkout> root
    Then it prints cap <cap>

    Examples:
      | marker                                          | checkout        | cap |
      | an active pause marker with no timer            | master checkout | 0   |
      | an active pause marker with no timer            | worktree        | 0   |
      | a pause marker whose timer has already expired  | master checkout | 7   |
      | a pause marker whose timer has already expired  | worktree        | 7   |
      | no pause marker                                 | master checkout | 7   |
      | no pause marker                                 | worktree        | 7   |

  # BL-1106 pause-visible-everywhere-02
  Scenario: A promotion invoked from a worktree promotes nothing while the pause holds
    Given the master checkout carries an active pause marker with no timer
    And a promotable ticket in the paused pool
    When the promotion path runs from the worktree root
    Then no ticket moves into the active pool
    And the ticket is still in the paused pool
