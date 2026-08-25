# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-25T19:02:49.412221143Z","feature_name":"BL-1124 property-suite fixtures must not mutate shared main","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1124-property-suite-fixtures-must-not-mutate-shared-main.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: BL-1124 property-suite fixtures must not mutate shared main
  Fixtures under the property suite must use isolated git directories only.
  They must never rename or advance shared main / live role refs, and
  must leave core.bare false on the shared checkout.

  # BL-1124 isolated-git-dir-01
  Scenario: a property fixture that needs git state uses an isolated temp repo
    Given a property-suite fixture that performs git ref or commit operations
    When the fixture runs
    Then those operations target only a temporary git directory
    And they do not rename or advance refs/heads/main on the shared live repo

  # BL-1124 post-lane-bare-assert-02
  Scenario: a property-suite lane fails if it left the shared checkout bare
    Given a shared live repo that starts with core.bare false
    When a property-suite lane finishes
    Then a post-lane assert requires core.bare to still be false
    And a lane that flipped bare exits non-zero

  # BL-1124 recovery-refuses-discard-when-ahead-03
  Scenario: recovery must not reset main to origin when local is ahead
    Given local main is ahead of origin/main by at least one commit
    When a recovery procedure would restore main to origin/main
    Then the procedure refuses or restores the pre-incident tip from reflog instead
    And the ahead commits remain reachable

  # BL-1124 live-role-worktree-ref-safe-04
  Scenario: fixtures never rename a live role worktree branch to main
    Given a live role worktree whose HEAD branch is swarmforge-documenter or swarmforge-coder
    When a property-suite fixture that would rename or retarget that branch runs
    Then the fixture uses only an isolated temp git directory
    And the live role branch ref is unchanged
    And refs/heads/main on the shared repo is not rewritten by the fixture
