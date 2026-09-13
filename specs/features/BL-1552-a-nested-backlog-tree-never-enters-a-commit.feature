Feature: BL-1552 A nested backlog tree never enters a commit

  The backlog lives at the repository root. A role whose shell sits in
  extension/ (where npm runs) and writes backlog/evidence/<file> relatively
  creates extension/backlog/evidence/<file>, and nothing at commit time
  refuses it: five such commits by four roles between 2026-09-07 and
  2026-09-13, three still on main with that pass's evidence nowhere under
  backlog/evidence/. This feature is that the pre-commit guard chain
  refuses a staged path whose backlog area directory is not at the root,
  naming the root-relative path the role meant, and that the three stray
  files are moved home in the same parcel.

  Background:
    Given a fixture repository initialised under mkdtemp with the commit guard scripts installed

  # BL-1552 nested-backlog-01
  Scenario Outline: a staged path under a nested backlog area is refused with the root path named
    Given the path <staged> is staged
    When the pre-commit guard chain runs
    Then the chain refuses the commit naming check_nested_backlog_path.sh
    And the refusal names <root_path> as the path the file belongs at

    Examples:
      | staged                                       | root_path                          |
      | extension/backlog/evidence/BL-1-cleaner-x.md | backlog/evidence/BL-1-cleaner-x.md |
      | swarmforge/backlog/paused/BL-1-y.yaml        | backlog/paused/BL-1-y.yaml         |

  # BL-1552 nested-backlog-02
  Scenario Outline: a root backlog path or a path that merely contains the word backlog is allowed
    Given the path <staged> is staged
    When the pre-commit guard chain runs
    Then check_nested_backlog_path.sh exits 0 and the chain does not name it

    Examples:
      | staged                                 |
      | backlog/evidence/BL-1-cleaner-x.md     |
      | docs/how-to/backlog-dashboard-notes.md |
      | extension/src/backlog/backlogReader.ts |

  # BL-1552 nested-backlog-03
  Scenario: the guard runs in the cheap tier and every violation is reported at once
    Given the path extension/backlog/evidence/BL-1-cleaner-x.md is staged
    And a second cheap-tier guard that refuses the same commit
    When the pre-commit guard chain runs
    Then the chain's one refusal names both check_nested_backlog_path.sh and the second guard

  # BL-1552 nested-backlog-04
  Scenario: the three stray evidence files are home and the nested tree is gone
    Given the parcel commit
    Then extension/backlog does not exist in its tree
    And backlog/evidence/BL-1278-hardender-20260909.md, backlog/evidence/BL-1478-cleaner-20260911.md and backlog/evidence/BL-1464-QA-20260913-summary.md exist with the stray files' content
    And exactly zero paths in its tree carry a backlog area directory that is not at the root
