Feature: BL-1657 The art-director tip guard resolves the art director's branch from the roster, whatever the pack names it

  check_art_director_tip.sh (BL-1444) judges an incoming tip by whether it
  is reachable from the art director's branch, and since 2026-09-06 that
  branch has been the literal primary/art-director - a name the nested
  pack uses and this host never had. On this host the seat's worktree is
  checked out on swarmforge-art-director (roles.tsv), so the guard refuses
  every tip ("<sha> is not on primary/art-director") and QA verifies each
  land by hand (2026-09-20, b4cce6448c). After this parcel the guard
  resolves the branch from the roster row for the art-director seat,
  refuses naming the ref it resolved and where it came from when that ref
  does not exist, and accepts an explicit --branch for callers that know
  better.

  Background:
    Given a fixture repository under a temporary directory with a main branch, a roles.tsv, and the guard's hook chain installed

  # BL-1657 the-branch-comes-from-the-roster-01
  Scenario Outline: a docs-only tip on the roster's art-director branch lands whatever the pack names that branch
    Given the roster's art-director row points at a worktree checked out on <branch>
    And a docs/design/ commit on <branch> not reachable from main
    When QA lands that tip by merge
    Then the merge commit lands

    Examples:
      | branch                  |
      | swarmforge-art-director |
      | primary/art-director    |

  # BL-1657 a-missing-branch-refuses-naming-its-source-02
  Scenario: a roster row whose worktree cannot be read refuses naming the ref and the roster as its source
    Given the roster's art-director row points at a worktree path that does not exist
    And a docs/design/ commit on swarmforge-art-director not reachable from main
    When QA lands that tip by merge
    Then the merge is refused
    And the refusal names the ref it resolved and the roster as its source

  # BL-1657 an-explicit-branch-wins-03
  Scenario: an explicit branch on the command line overrides the roster
    Given the roster's art-director row points at a worktree checked out on swarmforge-art-director
    And a docs/design/ commit on review/art-director not reachable from main
    When the guard runs in tip mode on that commit with --branch review/art-director
    Then the guard accepts the tip
