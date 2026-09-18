Feature: BL-1637 A seat's forward is filed where its completion gate looks

  The handoff daemon files a delivered forward under the sent folder of
  the role named by its from header, and a seat stamps from with its
  stage, so a second seat's forwards land under the stage's worktree while
  the completion gate reads only the seat's own folders. On 2026-09-18
  coder@2 forwarded BL-831, the cleaner claimed it in twelve seconds, and
  done_with_current refused the inbound as FORWARD_NOT_SENT; the seat
  completed it with --no-op. This feature is that a seat's completion gate
  finds a forward that seat sent after the dequeue wherever the daemon
  filed it, that a stale or absent forward is still refused, that a bare
  seat is unchanged, and that the daemon files a seat's delivered mail
  under that seat while from keeps the stage. The live check on a real
  post-land forward is QA's e2e step, not a scenario (BL-1541).

  Background:
    Given a fixture swarm root whose roles table declares coder as a task role with its own worktree and coder@2 as a second seat of that stage with its own worktree

  # BL-1637 seat-forward-filed-where-gate-looks-01
  Scenario Outline: the seat's completion depends on when the forward was sent, not where the daemon filed it
    Given coder@2 holds a git_handoff for a ticket, dequeued a minute ago
    And a git_handoff naming that ticket, sent by coder@2 <when>, sits in <folder>
    When coder@2 runs done_with_current with no flags
    Then the outcome is <outcome>

    Examples:
      | when               | folder                          | outcome                                      |
      | after the dequeue  | its own sent folder             | completed, the inbound in its completed folder |
      | after the dequeue  | the coder stage's sent folder   | completed, the inbound in its completed folder |
      | before the dequeue | the coder stage's sent folder   | refused as FORWARD_NOT_SENT                  |
      | never              | no folder at all                | refused as FORWARD_NOT_SENT                  |

  # BL-1637 seat-forward-filed-where-gate-looks-02
  Scenario: a bare seat scans exactly the two folders it scans today
    Given a fixture swarm root whose roles table declares architect as a task role with no seat rows
    When the forward-evidence gate lists the folders it scans for architect
    Then it lists architect's own sent and outbox folders and nothing else

  # BL-1637 seat-forward-filed-where-gate-looks-03
  Scenario: the daemon files a seat's delivered forward under that seat and leaves from as the stage
    Given coder@2's outbox holds a git_handoff addressed to the cleaner
    When the daemon's delivery pass runs on that fixture
    Then the file is in coder@2's sent folder
    And its from header still names coder
    And its seat header names coder@2
