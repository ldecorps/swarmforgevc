Feature: BL-1452 The bounce recorders and the sibling checker accept GitHub-seeded ticket ids

  Tickets seeded from GitHub issues carry GH-<n> ids (BL-114, the intake
  workflow); the bb-side gates parse BL-<n> and GH-<n> alike and
  swarmMetrics.ts's own TICKET_ID_PATTERN accepts both. The TypeScript CLIs
  do not: bounceArgsCore.ts's TICKET_PATTERN is ^BL-\d+$, shared by
  record-bounce.js and record-qa-bounce.js, and qa-sibling-check.js carries
  a copy. On 2026-09-06 QA bounced GH-24 and record-bounce.js printed its
  usage and exited; no JSONL record and no ticket bounce_history entry were
  written. is_qa_ancestor.sh vetoes approval from exactly those two stores,
  so a bounced GH commit with no record reads as QA-approved (the BL-952
  hazard) and its bounce is invisible to the per-role bounce-rate metrics.
  This feature is that one shared ticket-id predicate accepts BL-<n> and
  GH-<n>, the bounce recorders and the sibling checker use it, a GH bounce
  is recorded in both stores, and a malformed id is still refused.

  # BL-1452 a-gh-bounce-is-recorded-in-both-stores-01
  Scenario Outline: a bounce recorded against a ticket of either namespace lands in both stores
    Given a fixture repository holding an active ticket <id> and a ten-hex commit on its branch
    When record-bounce.js records a bounce for <id> against that commit
    Then the month's JSONL store gains one record naming <id> and the commit
    And the ticket's bounce_history gains one entry naming the commit
    And is_qa_ancestor.sh answers a clean no for that commit

    Examples:
      | id      |
      | GH-24   |
      | BL-1452 |

  # BL-1452 a-malformed-id-is-still-refused-02
  Scenario Outline: an id outside both namespaces is refused with the usage and nothing is written
    When record-bounce.js is given the ticket id <id>
    Then it exits non-zero printing the usage
    And no store is written

    Examples:
      | id       |
      | 24       |
      | GH24     |
      | XX-24    |
      | BL-      |

  # BL-1452 the-sibling-checker-accepts-gh-03
  Scenario: the sibling checker reports status for a GitHub-seeded ticket
    Given a fixture repository holding an active ticket GH-24
    When qa-sibling-check.js status runs for GH-24
    Then it exits zero and prints the ticket's deferral status
