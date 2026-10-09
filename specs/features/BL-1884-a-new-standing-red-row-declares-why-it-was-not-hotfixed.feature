# mutation-stamp: sha256=bdadac20c329e37754350dc8f51b9d1e20ff9885f565ff85ced3e9f91e19fce6
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-10-08T18:06:22.315969588Z","feature_name":"BL-1884 A new standing-red row declares why its red was not hotfixed","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1884-a-new-standing-red-row-declares-why-it-was-not-hotfixed.feature","background_hash":"0dcbf5dba70649acdf8ea42fa1763cd0b1d3a04953ef8580a3ad2cdaa9891b01","implementation_hash":"unknown","scenarios":[{"index":1,"name":"a row whose owner does not declare a valid fallback is refused","scenario_hash":"93613fb6b76573c7044471c4740f1628550328c9da2ecd8ccf86ba7a16f96a26","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-10-08T18:06:22.315969588Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1884 A new standing-red row declares why its red was not hotfixed

  The human's 2026-10-01 directive: a red on main is hotfixed in the same
  pass and gets a stamp-off; an owner ticket plus a register row is the
  fallback only when the fix needs a human ruling or is more than one
  sitting. That fallback was a prose rule, so taking it was invisible: on
  2026-10-02 the specifier minted an owner and a row for a red it could
  have hotfixed, and the human had to ask. The register's commit guard now
  refuses a commit that adds a row unless the owner ticket declares which
  fallback it took.

  Background:
    Given a fixture repository with the standing-red register guard and an open owner ticket

  # BL-1884 a-declared-fallback-lets-the-row-land-01
  Scenario: a row whose owner declares a multi-sitting fallback with a reason is accepted
    Given the owner ticket declares hotfix_fallback multi-sitting with a reason
    When a commit adds a register row naming that owner
    Then the commit is accepted

  # BL-1884 an-undeclared-fallback-refuses-the-row-02
  Scenario Outline: a row whose owner does not declare a valid fallback is refused
    Given the owner ticket <declaration>
    When a commit adds a register row naming that owner
    Then the commit is refused naming the row and the owner's missing fallback

    Examples:
      | declaration                                                  |
      | declares no hotfix_fallback                                  |
      | declares hotfix_fallback needs-ruling without ruling_options |
      | declares hotfix_fallback multi-sitting without a reason      |

  # BL-1884 a-row-already-on-main-is-not-judged-03
  Scenario: a row already on main is not judged by a commit that does not add it
    Given the register on main holds a row whose owner declares no hotfix_fallback
    When a commit changes another file
    Then the commit is accepted

  # BL-1884 a-hardening-row-is-not-a-red-04
  Scenario: a hardening-lane row records a deferred mutation pass, not a red, and is not judged
    Given the owner ticket declares no hotfix_fallback
    When a commit adds a hardening-lane register row naming that owner
    Then the commit is accepted
