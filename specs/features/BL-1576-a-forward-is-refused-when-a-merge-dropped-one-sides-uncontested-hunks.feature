Feature: BL-1576 a forward is refused when a merge on the sender's branch dropped one side's uncontested hunks

  Every role merges twice per hop - the received parcel commit and, often,
  `main` - and resolves whatever conflicts git raises by hand. A resolution
  that takes one side of a conflicted path verbatim re-adds every line the
  other side removed and drops every line it added, for hunks that side had
  the only claim to. Git raises the conflict because the two sides' edits
  are ADJACENT, not because they touch the same lines, so a correct
  resolution keeps both and nothing records that one was discarded.

  BL-1213's gate is blind here twice over: it reads only the paths the
  received commit itself touched, and it fires only when the tip blob is
  byte-identical to a pre-parcel blob. On 2026-09-15 the documenter's merge
  4566a68955 (`Merge hardender 6cf853db7f into documenter.`) resolved a
  conflict on `backlog/standing-reds.tsv` by keeping its own side: the six
  register rows the cleaner's 81a1ed3ec3 had removed (base lines 33-38) came
  back verbatim while `main`'s adjacent edits (base lines 39-40) were kept,
  so the tip matched no earlier blob and no gate spoke. QA found it by hand
  at the last stage (BL-1486 bounce, `backlog/evidence/BL-1486-bounce-20260915.md`).

  This gate runs where BL-1213 runs - the `git_handoff` send, the one place
  every hop crosses - and answers from git objects alone. It walks only the
  merge commits reachable from the forwarded commit and not from the
  received one, and only the paths their parents changed since the merge
  base. A line one side changed is a finding only when the other side never
  touched that hunk; a genuine same-line conflict is the resolver's to
  settle. A `This reverts commit` on the branch naming the commit that
  authored the dropped hunk excuses it, the same convention BL-1213 honours.

  Background:
    Given a fixture repository where a path was edited on two sides since their merge base
    And the received parcel commit removed lines from that path on one side
    And the sender's branch carries an adjacent edit to the same path on the other side
    And a role holding the received parcel commit in its in_process mailbox, ready to hand off

  # BL-1576 forward-refused-when-a-merge-dropped-one-sides-uncontested-hunks-01
  Scenario Outline: what the sender's merge did to each side's uncontested hunks decides the send
    Given the sender merged the received commit and resolved the path by <resolution>
    When the role sends the git_handoff
    Then the send is <outcome>

    Examples:
      | resolution                                                                    | outcome |
      | keeping both sides' hunks                                                     | allowed |
      | git's own clean auto-merge, no conflict raised                                | allowed |
      | taking the sender's side verbatim, so the received side's removed lines return | refused |
      | dropping a line the received side added                                       | refused |
      | taking the received side verbatim, so the sender side's added line is gone     | refused |

  # BL-1576 forward-refused-when-a-merge-dropped-one-sides-uncontested-hunks-02
  Scenario: a pick inside a genuinely contested hunk is never refused
    Given both sides rewrote the same base line of that path differently
    And the sender merged the received commit and resolved that line by keeping one side's rewrite
    When the role sends the git_handoff
    Then the send is allowed
    And the gate records no finding

  # BL-1576 forward-refused-when-a-merge-dropped-one-sides-uncontested-hunks-03
  Scenario: the refusal names the merge, the path, the side dropped and how many lines
    Given the sender merged the received commit and resolved the path by taking the sender's side verbatim, so the received side's removed lines return
    When the role sends the git_handoff
    Then the send is refused
    And the refusal names the merge commit
    And the refusal names the path
    And the refusal says the received side's hunks were dropped
    And the refusal states the number of lines dropped

  # BL-1576 forward-refused-when-a-merge-dropped-one-sides-uncontested-hunks-04
  Scenario: a revert on the branch naming the commit that authored the dropped hunk excuses it
    Given the sender merged the received commit and resolved the path by taking the sender's side verbatim, so the received side's removed lines return
    And the sender's branch carries a git revert of the received parcel commit after that merge
    When the role sends the git_handoff
    Then the send is allowed

  # BL-1576 forward-refused-when-a-merge-dropped-one-sides-uncontested-hunks-05
  Scenario: the gate warns and sends when it cannot read the facts it needs
    Given the sender merged the received commit and resolved the path by taking the sender's side verbatim, so the received side's removed lines return
    And the received parcel commit recorded in the in_process mailbox cannot be read
    When the role sends the git_handoff
    Then the send is allowed
    And a warning names the ticket whose received commit could not be read

  # BL-1576 forward-refused-when-a-merge-dropped-one-sides-uncontested-hunks-06
  Scenario: a forward that made no merge is untouched
    Given the sender committed on top of the received commit without merging anything
    When the role sends the git_handoff
    Then the send is allowed
    And the gate records no finding

  # BL-1576 forward-refused-when-a-merge-dropped-one-sides-uncontested-hunks-07
  Scenario: a note is untouched
    Given the sender merged the received commit and resolved the path by taking the sender's side verbatim, so the received side's removed lines return
    When the role sends a note instead of a git_handoff
    Then the send is allowed
    And the gate records no finding
