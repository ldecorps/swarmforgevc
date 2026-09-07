# mutation-stamp: sha256=98ae5d283f20fc09eb35f48bd42e2b197aa8fc61ee36d533458326a6ba0a770e
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-07T12:50:39.566609176Z","feature_name":"BL-1452 The bounce recorders and the sibling checker accept GitHub-seeded ticket ids","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1452-the-bounce-recorders-accept-github-seeded-ticket-ids.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a bounce recorded against a ticket of either namespace lands in both stores","scenario_hash":"858d459f265612b82e8e7b09aae454a6f0dfbfe22b4864fb36c89dceee1a61f7","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-07T12:50:39.566609176Z"},{"index":1,"name":"an id outside both namespaces is refused with the usage and nothing is written","scenario_hash":"92a9feefd00c44ddf6bcabfd6f8b38b463ea50daf9cc93db90b7429704319add","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-07T12:50:39.566609176Z"}]}
# acceptance-mutation-manifest-end

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
