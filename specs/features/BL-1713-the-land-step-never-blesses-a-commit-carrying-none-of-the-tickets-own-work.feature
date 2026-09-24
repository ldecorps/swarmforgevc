Feature: BL-1713 The land step never blesses a commit carrying none of the ticket's own work

  On 2026-09-24 QA ran the land step from its own worktree with HEAD and
  the shared checkout's root as the repo root. The CLI resolved HEAD in
  the shared checkout, whose HEAD was origin/main, found nothing
  delivered, and printed LAND_CLEAN for a built commit whose only change
  retired BL-1691's standing-red register row. It did the same for
  BL-1694. QA hand-built both lands. This feature is that a commit
  argument meaning different commits in the caller's checkout and the
  repo root is refused, that a range carrying no commit credited to the
  landing ticket is refused, and that an ordinary land is unchanged.

  Background:
    Given a fixture origin with a main checkout at origin/main and a QA worktree whose tip carries ticket A's own commit and a standing-red register row owned by A

  # BL-1713 a-citation-carrying-none-of-the-tickets-work-is-refused-01
  Scenario Outline: the CLI refuses a citation that does not name a commit carrying A's own work
    When the land step CLI is run from the QA worktree for A's land citing "<cited commit>" with the main checkout as repo root
    Then it prints LAND_ESCALATE naming <reason>
    And the land step built no commit and created no branch

    Examples:
      | cited commit                                                | reason                           |
      | HEAD                                                        | both commits HEAD resolves to    |
      | origin/main's full sha                                      | A and the range from origin/main |
      | the full sha of a tip whose only new commit names no ticket | A and the range from origin/main |

  # BL-1713 an-ordinary-land-is-unchanged-02
  Scenario: A's land cited by its full sha from the QA worktree still lands A's own work
    When the land step CLI is run from the QA worktree for A's land citing "the QA worktree tip's full sha" with the main checkout as repo root
    Then it prints LAND_CLEAN with a built commit whose diff against origin/main names A's own path
    And that built commit retires the register row owned by A
