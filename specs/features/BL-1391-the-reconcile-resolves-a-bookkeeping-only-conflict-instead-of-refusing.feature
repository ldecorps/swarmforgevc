Feature: BL-1391 The reconcile resolves a bookkeeping-only conflict instead of refusing

  The reconcile refuses any merge whose verdict is a conflict, which is
  right for code and wrong for the conflicts that actually occur on the
  shared checkout: a note two roles appended, a record QA wrote at land
  beside a note the specifier wrote on main, two appends to one evidence
  file. Each halts the coordinator until a human merges by hand. This
  feature is that a conflict confined to append-only bookkeeping files is
  resolved losslessly and visibly, and that anything else still refuses.

  Background:
    Given a master checkout whose local main and origin/main have diverged

  # BL-1391 two-appends-to-one-ticket-are-both-kept-01
  Scenario: a ticket YAML appended on both sides absorbs with both additions kept
    Given ours appended a notes entry to ticket "BL-9002" and theirs added an abandoned_commits line
    When the reconcile sweep absorbs origin/main
    Then the absorb completes with no MERGE_HEAD left
    And ticket "BL-9002" carries both additions
    And the merge commit body names the path and the strategy
    And the daemon log carries bookkeeping-conflict naming the path

  # BL-1391 a-rewritten-field-still-refuses-02
  Scenario: a ticket YAML whose scalar field changed on both sides is refused as today
    Given ours and theirs both changed the title of ticket "BL-9002"
    When the reconcile sweep absorbs origin/main
    Then the absorb is refused
    And no merge commit exists
    And nothing was resolved

  # BL-1391 one-code-conflict-resolves-nothing-03
  Scenario: a conflict that includes a non-bookkeeping path resolves nothing at all
    Given ours appended a notes entry to ticket "BL-9002" and theirs added an abandoned_commits line
    And ours and theirs conflict in a daemon script
    When the reconcile sweep absorbs origin/main
    Then the absorb is refused
    And ticket "BL-9002" is untouched on local main

  # BL-1391 append-only-evidence-is-concatenated-04
  Scenario Outline: an evidence file is resolved only when both sides merely appended
    Given ours appended a paragraph to an evidence file and theirs <theirs change>
    When the reconcile sweep absorbs origin/main
    Then the absorb <outcome>

    Examples:
      | theirs change                 | outcome                                   |
      | appended a different paragraph | completes with both paragraphs present   |
      | deleted an existing paragraph | is refused                                |

  # BL-1391 the-resolution-passes-the-same-guards-05
  Scenario: a resolved absorb runs the same commit guards as any merge on main
    Given ours appended a notes entry to ticket "BL-9002" and theirs added an abandoned_commits line
    And the pre-merge-commit guard chain is armed to refuse
    When the reconcile sweep absorbs origin/main
    Then the absorb is refused by the guard chain
    And no merge commit exists
