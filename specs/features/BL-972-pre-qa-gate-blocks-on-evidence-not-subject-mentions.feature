Feature: BL-972 pre-QA gate blocks on dropped-work evidence, not subject mentions

  The pre-QA gate's ancestry check must block a documenter-to-QA forward only
  on EVIDENCE that a non-ancestor commit carries the ticket's work (touched
  paths overlapping the parcel, or diff content), never because the ticket id
  merely appears in a commit's subject line. A subject-only match surfaces as
  a warning for attention; it does not block. Reverts, bookkeeping records,
  and cross-references name tickets whose content they deliberately exclude -
  today each such commit on any role branch blocks that ticket's forward.

  Background:
    Given a ticket "BL-900" whose cited parcel commit touches "extension/src/swarm/foo.ts" and "specs/features/BL-900-x.feature"
    And a role branch holds a commit "aaaaaaaaaa" that is not an ancestor of the cited commit, main, or origin/main
    And commit "aaaaaaaaaa" names "BL-900" in its subject line

  # BL-972 pre-qa-gate-blocks-on-evidence-not-subject-mentions-01
  Scenario Outline: blocking requires path evidence, and abandoned_commits always exempts
    Given commit "aaaaaaaaaa" touches only "<touched>"
    And the ticket's abandoned_commits listing for "aaaaaaaaaa" is <abandoned>
    When the pre-QA gate evaluates the forward for "BL-900"
    Then the gate's ancestry verdict for commit "aaaaaaaaaa" is "<verdict>"

    Examples:
      | touched                    | abandoned | verdict          |
      | backlog/topics/BL-900.md   | absent    | warning-no-block |
      | extension/src/swarm/foo.ts | absent    | block            |
      | extension/src/swarm/foo.ts | present   | exempt-no-block  |
