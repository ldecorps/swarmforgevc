# mutation-stamp: sha256=351320dd9685f1ca3510a0ed39cf0d593f5367d05f9a94c9a3a978115f169924
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-04T18:32:10.627226475Z","feature_name":"BL-1391 The reconcile resolves a bookkeeping-only conflict instead of refusing","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1391-the-reconcile-resolves-a-bookkeeping-only-conflict-instead-of-refusing.feature","background_hash":"c705b42b4ef1cf0ef3e5f13c7b4be3445c93ae32644cc90fa8262cf440a76402","implementation_hash":"unknown","scenarios":[{"index":3,"name":"an evidence file is resolved only when both sides merely appended","scenario_hash":"6bd1205d1bf7552b48982965b401ec3b0d65c6132f003ffcd97f89d64c8fa894","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-04T18:29:39.560349396Z"}]}
# acceptance-mutation-manifest-end

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
