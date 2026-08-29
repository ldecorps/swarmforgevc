# mutation-stamp: sha256=af297c78942ef4b9ff845dc4fd1f54ba73ec4376ae01cac4cf24a0f82f594136
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-29T11:44:41.409894697Z","feature_name":"the hygiene gate's duplicate-id check never counts the subject as another holder of its own id","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1194-hygiene-gate-relative-path-self-duplicate-false-positive.feature","background_hash":"b1b04f44aada98dd90e25779c50b822dea85a80a7eb8996e97e5521ee6575049","implementation_hash":"unknown","scenarios":[{"index":1,"name":"A genuine duplicate is still caught regardless of the path form used to invoke the gate","scenario_hash":"f93c593b90d7afb944ba419021706bf6847194495bd34592e5f5e7402f4b14dc","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-29T11:44:41.409894697Z"}]}
# acceptance-mutation-manifest-end

Feature: the hygiene gate's duplicate-id check never counts the subject as another holder of its own id

  # BL-1194 (epic deprecator; discovered 2026-08-27 while minting BL-1193,
  # widened same-day after re-gating amended BL-1190). Two independent
  # self-identity gaps in specifier_backlog_hygiene_gate.bb's duplicate-id
  # check (BL-1105), both in `other-holders`:
  #
  # Bug #1 (local): the local corpus index is always built from an ABSOLUTE
  # backlog-root, so a subject passed by a working-directory-relative path
  # (the natural, documented invocation) never string-equals its own
  # absolute corpus entry and is never excluded from its own holder list.
  #
  # Bug #2 (published): even with the subject correctly excluded locally,
  # the "same checkout" published-side dedup derives its exclusion set from
  # OTHER local holders (after removing the subject) — which is empty for
  # the ordinary case of one local holder — so a published (origin/main)
  # entry that is simply the subject's own already-committed copy is never
  # recognized as "this ticket" and is reported as another holder.

  Background:
    Given a backlog corpus the hygiene gate reads ticket ids from

  # BL-1194 relative-path-self-not-a-duplicate-01
  Scenario: A brand-new ticket passed by a working-directory-relative path is not reported as its own duplicate
    Given the corpus does not contain "BL-4242" locally
    When the specifier runs the hygiene gate on a new ticket whose id is "BL-4242" using a "relative" path
    Then the gate does not report a duplicate ticket id

  # BL-1194 relative-path-genuine-duplicate-still-caught-02
  Scenario Outline: A genuine duplicate is still caught regardless of the path form used to invoke the gate
    Given the corpus already contains a ticket with id "BL-4242" in "paused"
    When the specifier runs the hygiene gate on a new ticket whose id is "BL-4242" using a "<path_form>" path
    Then the gate fails
    And the output reports a duplicate ticket id

    Examples:
      | path_form |
      | relative  |
      | absolute  |

  # BL-1194 published-self-not-a-duplicate-03
  Scenario: A ticket already published under its own id and file is not reported as a duplicate of itself when re-gated
    Given the corpus already contains a ticket with id "BL-4242" in "paused"
    And the published corpus already contains that exact "BL-4242" ticket file, unchanged
    When the specifier runs the hygiene gate on the existing "BL-4242" ticket using a "relative" path
    Then the gate does not report a duplicate ticket id

  # BL-1194 published-different-file-still-caught-04
  Scenario: A published ticket that is a genuinely different file under the same id is still caught
    Given the corpus does not contain "BL-4242" locally
    And the published corpus contains a different ticket file with id "BL-4242"
    When the specifier runs the hygiene gate on a new ticket whose id is "BL-4242" using a "relative" path
    Then the gate fails
    And the output reports a duplicate ticket id
