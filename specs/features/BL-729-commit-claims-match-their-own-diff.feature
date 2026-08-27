# mutation-stamp: sha256=badb64c800a7b82027ca18c09f9aa9ec9b3abc9fc62a3e29bcb3587ef85d066f
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-01T08:14:19.825256287Z","feature_name":"a piloted ticket lands only when each commit's claims match its own diff","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-729-commit-claims-match-their-own-diff.feature","background_hash":"f4ae1c97a891965f5618bc95b572415bf946a63beac934fc360f99d033ae0c51","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a message is judged on what it claims to have changed, not on what it mentions","scenario_hash":"b75890b6f1a99604f5c6dbb46ffff22a3ee9eecc4404aa8b083202b479b899b7","mutation_count":9,"result":{"Total":9,"Killed":9,"Survived":0,"Errors":0},"tested_at":"2026-08-01T08:14:16.533610512Z"}]}
# acceptance-mutation-manifest-end

Feature: a piloted ticket lands only when each commit's claims match its own diff

  # BL-729: BL-636's landing commit message said it restored a `deliver!` close
  # paren dropped by BL-611. That token appears nowhere in the commit's own
  # patch - the repair existed only on the unmerged sibling branch
  # expedite/BL-571. Nothing between "the agent wrote that sentence" and the
  # ticket reaching backlog/done/ ever cross-referenced the message against the
  # diff, so a described fix was indistinguishable from a made fix.
  #
  # The gate that already owns the pilot's only landing path (BL-727) grows a
  # second refusal: before the yaml moves, every non-merge commit the run
  # authored is checked, and a change claimed over an identifier absent from
  # that commit's own patch refuses the land.
  #
  # Judged per commit, against that commit's own patch text - added, removed
  # and context lines, plus the changed-path list - never the worktree and
  # never a sibling branch, which is precisely what BL-636 conflated.

  Background:
    Given a piloted ticket whose declared acceptance contract has just passed

  # BL-729 claim-judged-against-own-patch-01
  Scenario Outline: a message is judged on what it claims to have changed, not on what it mentions
    Given a run commit whose message <mention> the identifier "deliver!"
    And that commit's own patch <patch> that identifier
    When the pilot runs the landing gate
    Then the land is <outcome>

    Examples:
      | mention                            | patch         | outcome   |
      | claims to have restored            | never contains | refused   |
      | claims to have restored            | contains       | completed |
      | names in passing, claiming no change to | never contains | completed |

  # BL-729 every-run-commit-judged-02
  Scenario: a claim in an earlier stage commit refuses the land, not only one at the tip
    Given the run authored three commits on its branch
    And the first of them claims a change to an identifier its own patch never contains
    And every claim in the two later commits is supported by its own patch
    When the pilot runs the landing gate
    Then the land is refused
    And the refusal names the first commit

  # BL-729 generated-merge-message-not-judged-03
  Scenario: a merge commit's generated message is not judged
    Given the run merged main into its branch
    And that merge commit's message names a file the merge's own patch does not list
    And every claim in the run's non-merge commits is supported by its own patch
    When the pilot runs the landing gate
    Then the land is completed

  # BL-729 refusal-names-what-to-fix-04
  Scenario: a refusal names the commit, the identifier, and the sentence that claimed it
    Given a run commit claims a change to an identifier its own patch never contains
    When the pilot runs the landing gate
    Then the refusal names that commit, that identifier, and the sentence claiming it

  # BL-729 refused-land-is-inert-05
  Scenario: a land refused for an unsupported claim writes nothing
    Given a run commit claims a change to an identifier its own patch never contains
    When the pilot runs the landing gate
    Then the ticket yaml stays where it was
    And no acceptance receipt is written

  # BL-729 unreadable-history-fails-open-06
  Scenario: history the gate cannot read lets the land through, warning that claims went unchecked
    Given the gate cannot resolve the run's own commits
    When the pilot runs the landing gate
    Then the land is completed
    And the outcome warns that no commit claim was checked

  # BL-729 receipt-records-the-check-07
  Scenario: a completed land records how many commits were claim-checked
    Given every claim in the run's non-merge commits is supported by its own patch
    When the pilot runs the landing gate
    Then the land is completed
    And the receipt records how many commits were claim-checked
