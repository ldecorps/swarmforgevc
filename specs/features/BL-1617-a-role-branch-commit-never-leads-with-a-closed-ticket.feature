Feature: BL-1617 A role-branch commit never leads with a closed ticket

  The land step (BL-1241) replays only the landing ticket's own paths onto
  origin/main. It attributes every path in the tip by the first ticket id
  in the subjects of the commits that touched it, and it refuses - never
  decides silently - a path whose only owners are closed on origin/main
  (BL-1546). So a single commit on a role branch whose subject leads with
  a closed ticket blocks every parcel behind it on that branch: the
  documenter's "BL-1576: evidence - merge-drop guard false positive ..."
  (cbde915b2e, 2026-09-16) held BL-1608 and BL-1607 at land on 2026-09-17
  until the specifier landed the file on main by hand. This feature is
  that the commit-msg chain refuses such a subject on a role branch at
  commit time, names the closed ticket and what to lead with instead, and
  stays silent on main, on an untagged subject and when origin/main cannot
  be read.

  Background:
    Given a fixture repository whose origin/main files BL-0001 under backlog/done/ and BL-0002 under backlog/active/

  # BL-1617 role-branch-commit-never-leads-with-a-closed-ticket-01
  Scenario Outline: the leading ticket id of a role-branch commit decides
    Given the repository is checked out on a role branch
    When a commit is attempted with the subject "<subject>"
    Then the commit <outcome>

    Examples:
      | subject                                  | outcome                                                                 |
      | BL-0001: evidence about the old gate     | is refused naming BL-0001 as closed and telling the author to lead with the open owner |
      | Revert BL-0001's row re-add              | is refused naming BL-0001 as closed and telling the author to lead with the open owner |
      | BL-0002: fix - see BL-0001's gate        | is committed                                                            |
      | docs: a subject naming no ticket         | is committed                                                            |
      | Revert the BL-0001/BL-0002 row re-add    | is refused as ambiguous naming BL-0001 and BL-0002 and telling the author to lead with the open owner |
      | BL-0009: a subject leading with an id that has no ticket file | is refused naming BL-0009 as unknown on origin/main and telling the author to lead with the open owner |

  # BL-1617 role-branch-commit-never-leads-with-a-closed-ticket-02
  Scenario: the guard is silent on main
    Given the repository is checked out on main
    When a commit is attempted with the subject "BL-0001: evidence about the old gate"
    Then the commit is committed

  # BL-1617 role-branch-commit-never-leads-with-a-closed-ticket-03
  Scenario: an unreadable origin/main warns and commits
    Given the repository is checked out on a role branch
    And origin/main cannot be resolved
    When a commit is attempted with the subject "BL-0001: evidence about the old gate"
    Then the commit is committed and the guard warns that it could not read origin/main
