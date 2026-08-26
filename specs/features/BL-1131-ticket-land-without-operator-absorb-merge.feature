Feature: BL-1131 ticket land reaches behind=0 without operator absorb merge
  # Residual after BL-1130: refuse-clean still left wait-dirty-clear until a
  # human completed origin/main absorb. Successful lands must reach behind=0
  # with coordinator proceed and no operator conflict resolution.
  #
  # Design lock (specifier 2026-08-25) — primary (b) + rematch (a):
  # 1. Before publish: rematch the land tip so it already contains
  #    origin/main (FF or clean join). If that rematch conflicts, surface
  #    rematch to the lander — never leave MERGE_HEAD for an operator.
  # 2. After publish: local master absorb is FF-only from origin/main (or
  #    the landed tip). Local-ahead bookkeeping that would collide is
  #    replayed onto the new tip (cherry-pick/rebase) without opening a
  #    human absorb merge; replay conflict → rematch that bookkeeping
  #    owner, not "Complete origin/main merge".
  # 3. Soft (c): during the land window, coordinator bookkeeping must not
  #    rewrite paths in the land tip's change set (or must land after
  #    absorb). BL-1130 clean-refuse remains for true tip failures.
  # Out of scope: heuristic auto-merge of conflicted file contents.

  Background:
    Given a master checkout that runs BL-891-style origin/main absorb
    And BL-1130 clean-refuse behaviour remains in force

  # BL-1131 successful-land-behind-zero-01
  Scenario: a successful land reaches behind=0 without human absorb merge
    Given local main is ahead of origin/main with overlapping ticket paths
    And a ticket land tip is prepared under the BL-1131 rematch-then-FF rule
    When that tip publishes to origin/main and the automated absorb path runs
    Then behind is 0
    And no human conflict-resolution or absorb-merge commit was required
    And coordinator sync action is proceed

  # BL-1131 no-operator-absorb-as-recovery-02
  Scenario: ordinary land race does not page operator absorb as recovery
    Given local main is ahead and an ordinary ticket land would collide on paths
    When the land-plus-absorb pipeline runs under the BL-1131 rule
    Then the designed recovery is rematch for the lander or bookkeeping owner
    And the designed recovery is not an operator completing a conflicted merge
    And the worktree has no MERGE_HEAD

  # BL-1131 prepublish-tip-contains-origin-03
  Scenario: successful pre-publish rematch makes origin/main an ancestor of the tip
    Given a land tip that is behind origin/main
    And rematch onto origin/main would join cleanly
    When the pre-publish rematch step runs
    Then the tip that may be published contains origin/main as an ancestor
    And the worktree has no MERGE_HEAD

  # BL-1131 prepublish-rematch-fails-clean-04
  Scenario: conflicting pre-publish rematch fails cleanly without operator MERGE_HEAD
    Given a land tip that is behind origin/main
    And rematch onto origin/main would conflict
    When the pre-publish rematch step runs
    Then rematch fails cleanly naming the lander
    And the worktree has no MERGE_HEAD
