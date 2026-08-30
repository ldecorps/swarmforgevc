Feature: The land step's replay runs from the worktree the caller is actually in
  The land step's tip-pure replay builds its scratch checkout under the
  repository's git directory. In a linked worktree - the only place a
  pipeline role ever works - ".git" is a FILE pointing at the real git
  directory, not a directory, so the scratch path names somewhere that
  cannot hold a checkout and the replay never runs at all. The same failed
  attempt also leaves behind the scratch branch it asked git to create, so
  a retry fails for a different reason than the first attempt did, and the
  reader is sent chasing the second reason instead of the first.

  Background:
    Given a repository whose approved commit is entangled with an unlanded sibling

  # BL-1298 replay-runs-from-a-linked-worktree-01
  Scenario Outline: The replay's answer does not depend on which checkout invoked it
    Given the land step is invoked from <checkout>
    When the land step replays the ticket's own paths onto origin/main
    Then the replay reports a tip-pure commit for the ticket
    And the replayed tree holds exactly the ticket's own paths

    Examples:
      | checkout          |
      | the main checkout |
      | a linked worktree |

  # BL-1298 replay-runs-from-a-linked-worktree-02
  Scenario: A replay that cannot create its scratch checkout leaves no branch behind
    Given the replay cannot create its scratch checkout
    When the land step reports the failure
    Then no scratch branch for that ticket and commit remains in the repository

  # BL-1298 replay-runs-from-a-linked-worktree-03
  Scenario: A retry after a failed replay reports the first attempt's reason
    Given a replay for the ticket has already failed once
    When the land step is invoked again with the same ticket and commit
    Then the reported reason is the first attempt's reason
