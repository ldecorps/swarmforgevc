# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-10T08:01:12.483922Z","feature_name":"A close commit is validated and credited once per ticket it closes","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-869-multi-ticket-close-guard.feature","background_hash":"d06e2c5f6cd99c8cf2a0d50a3a529333273f2be3069d7ab4d43779aae929092d","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: A close commit is validated and credited once per ticket it closes

  Background:
    Given a coordinator mailbox holding no handoffs

  # BL-869 multi-ticket-close-guard-01
  Scenario Outline: a QA note crediting several tickets credits every id it names
    Given a note from QA to the coordinator approving "BL-857,BL-849,BL-840"
    When the close guard is asked whether "<ticket>" is QA-approved
    Then the close guard answers "<approved>"

    Examples:
      | ticket | approved |
      | BL-857 | yes      |
      | BL-849 | yes      |
      | BL-840 | yes      |
      | BL-999 | no       |

  # BL-869 multi-ticket-close-guard-02
  Scenario Outline: every ticket in a close is validated, whatever order the paths arrive in
    Given a note from QA to the coordinator approving "BL-857,BL-849"
    When a close commit moves "BL-857,BL-849" from active to done with its paths "<order>"
    Then the close is allowed
    And the close guard reports the closed tickets as "BL-857,BL-849"

    Examples:
      | order                                                  |
      | grouped so each active path precedes its own done path |
      | interleaved so the first active and first done differ   |

  # BL-869 multi-ticket-close-guard-03
  Scenario: one unapproved ticket blocks the whole close and the block names that ticket
    Given a note from QA to the coordinator approving "BL-857"
    When a close commit moves "BL-857,BL-849" from active to done
    Then the close is blocked
    And the block reason names "BL-849"

  # BL-869 multi-ticket-close-guard-04
  Scenario: every ticket the commit closed gets its own post-close side effects
    Given a note from QA to the coordinator approving "BL-857,BL-849"
    And an in-flight handoff for "BL-857,BL-849"
    When a close commit moves "BL-857,BL-849" from active to done
    Then the in-flight handoffs abandoned name "BL-857,BL-849"
    And the lifecycle ledger records a close for "BL-857,BL-849"

  # BL-869 multi-ticket-close-guard-05
  Scenario Outline: single-id extraction keeps the first-match contract its existing callers rely on
    When one ticket id is extracted from "<text>"
    Then the extracted id is "<id>"

    Examples:
      | text                                 | id     |
      | BL-217-inbound-email-webhook         | BL-217 |
      | QA approved BL-857,BL-849,BL-840     | BL-857 |
      | just a note with no ticket reference | (none) |
