Feature: The review-time entangled-tip check answers "did this author work outside the ticket?"
  A reviewer deciding whether a parcel's tip is entangled must measure the
  paths its own commits introduced for the named task, not everything the tip
  differs from origin/main by. origin/main lags local work by design, so the
  difference is dominated by commits the parcel's author never made. The
  send-time gate was corrected to the authored-scope basis on 2026-08-28; the
  review-time check is the same question and must reach the same verdict.

  Background:
    Given a repository whose local "main" is ahead of "origin/main" by commits the parcel's author did not write
    And a parcel citing a commit for the task "BL-alpha"

  # BL-1257 review-time-scope-check-shares-the-corrected-basis-01
  Scenario: Lag alone is not entanglement
    Given the cited commit's own commits for "BL-alpha" touch only paths owned by "BL-alpha"
    And the tip additionally contains commits that are already on local "main"
    When the review-time scope check runs on the cited commit
    Then the check reports no foreign scope
    And the paths contributed by the commits already on local "main" are not listed

  # BL-1257 review-time-scope-check-shares-the-corrected-basis-02
  Scenario: A path the author actually wrote outside the ticket is still caught
    Given a commit named for "BL-alpha" also touches a path owned by "BL-beta"
    When the review-time scope check runs on the cited commit
    Then the check reports foreign scope
    And the reported paths include the path owned by "BL-beta"

  # BL-1257 review-time-scope-check-shares-the-corrected-basis-03
  Scenario Outline: The review-time check and the send-time gate agree
    Given a cited commit of shape "<shape>"
    When the send-time scope gate and the review-time scope check both run on it
    Then both report foreign scope "<verdict>"

    Examples:
      | shape                                      | verdict |
      | authored-scope-clean-with-origin-lag       | no      |
      | authored-scope-clean-with-landed-siblings  | no      |
      | authored-commit-touching-a-foreign-ticket  | yes     |

  # BL-1257 review-time-scope-check-shares-the-corrected-basis-04
  Scenario: An entanglement refusal names the paths and their owning tickets
    Given a commit named for "BL-alpha" also touches a path owned by "BL-beta"
    When the review-time scope check refuses the parcel
    Then the refusal names each foreign path
    And the refusal names the ticket that owns each foreign path
    And the refusal does not state a bare count of paths differing from "origin/main"
