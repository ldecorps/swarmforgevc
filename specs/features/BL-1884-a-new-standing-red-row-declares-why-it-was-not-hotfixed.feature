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
