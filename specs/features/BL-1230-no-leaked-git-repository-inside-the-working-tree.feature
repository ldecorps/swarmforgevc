Feature: A git repository leaked inside the working tree is caught, not left to hijack git

  A `.git` directory is the one thing git will never report. It is not tracked,
  it is not untracked, `git status` says nothing about it and `git clean` will
  not touch it. So a fixture that runs `git init` with its cwd set to a real
  directory of the repository leaves behind an artifact that no ordinary
  hygiene check can see.

  What it does do is redirect every git command run from inside that directory.
  On 2026-08-27 one appeared at `backlog/.git` — no remote, no refs, no
  commits, and 3338 backlog files staged in its index. From that moment
  `cd backlog && git rev-parse --show-toplevel` answered `.../backlog` rather
  than the repository root, in the directory where the coordinator does its
  `git mv` bookkeeping between active/ and done/.

  This is not the temp-directory leak class. That one fills /tmp; this one
  lands inside the tracked tree and changes what git means there.

  Background:
    Given a repository working tree

  # BL-1230 no-leaked-git-repository-in-working-tree-01
  Scenario: A git repository nested in a tracked directory is reported
    Given a git repository exists at "backlog/.git"
    When the leaked-repository check runs
    Then "backlog/.git" is reported
    And the report says a git command run from that directory resolves to it

  # BL-1230 no-leaked-git-repository-in-working-tree-02
  Scenario Outline: A repository git itself put there is not a leak
    Given <legitimate location> exists
    When the leaked-repository check runs
    Then nothing is reported

    Examples:
      | legitimate location                     |
      | the worktree gitfile ".worktrees/coder/.git" |
      | the repository's own root ".git"        |
      | a nested repository under "node_modules" |

  # BL-1230 no-leaked-git-repository-in-working-tree-03
  Scenario: The check reports without removing anything
    Given a git repository exists at "backlog/.git"
    When the leaked-repository check runs
    Then "backlog/.git" is reported
    And "backlog/.git" still exists

  # BL-1230 no-leaked-git-repository-in-working-tree-04
  Scenario: A clean working tree reports nothing
    Given no git repository is nested inside the working tree
    When the leaked-repository check runs
    Then nothing is reported

  # BL-1230 no-leaked-git-repository-in-working-tree-05
  Scenario: A leaked repository is caught even though git reports the tree as clean
    Given a git repository exists at "backlog/.git"
    And "git status" reports the working tree clean
    When the leaked-repository check runs
    Then "backlog/.git" is reported
