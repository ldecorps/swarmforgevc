Feature: A replay tip adds only the content of the ticket being landed

  land_step_lib.bb's own-paths delegates to task_scope_gate_lib.bb's
  task-tagged-changed-paths, which filters candidates to commits whose subject
  names the ticket and then expands each one with own-commit-changed-paths
  :delivered. For a merge, :delivered is a real two-tree diff against the FIRST
  parent - so it returns everything the second parent brought in, whoever
  authored it and whatever ticket it belongs to.

  A role's forward-merge takes its subject from the ticket it forwards. An
  earlier, still-unlanded ticket whose work rode along on that branch is
  therefore swept into the replay tip under the forwarded ticket's name.

  BL-1308 widened the sibling DETECTOR to see this, and said so in its own
  comment: "the detector under-included in exactly the place the path set
  over-includes. Only DETECTION widens here." So the tip is now correctly
  NAMED as entangled - and is still built carrying content it should not.
  Twice in two days a verified-green parcel was held rather than landed:
  BL-1307 over BL-1300 on 2026-08-30, BL-1298 over BL-1303 on 2026-08-31.

  Background:
    Given a QA tip whose ticket-tagged merge imports a role branch
    And the sibling detector reports every ticket that branch carries

  # BL-1315 replay-tip-carries-only-the-landed-ticket-01
  Scenario: A sibling's unlanded content does not enter the replay tip
    Given the imported branch carries, besides the landed ticket, a sibling that is "unlanded"
    When the replay builds its tip
    Then the tip adds no path attributable only to the sibling
    And the tip still adds every path the landed ticket's own chain delivered

  # BL-1315 replay-tip-carries-only-the-landed-ticket-02
  Scenario Outline: A sibling that contributes no novel content is not subtracted
    Given the imported branch carries, besides the landed ticket, a sibling that is "<sibling>"
    When the replay builds its tip
    Then the tip is unchanged from the full delivered set

    Examples:
      | sibling                                  |
      | already landed on origin/main            |
      | byte-identical to what origin/main holds |

  # BL-1315 replay-tip-carries-only-the-landed-ticket-03
  Scenario: Every role's contribution to the landed ticket survives
    Given the landed ticket chain delivered content authored by "coder" and by "hardender"
    And only the documenter's forward-merge names the ticket in its subject
    When the replay builds its tip
    Then the tip adds the paths delivered by "coder"
    And the tip adds the paths delivered by "hardender"

  # BL-1315 replay-tip-carries-only-the-landed-ticket-04
  Scenario: An undeterminable attribution refuses rather than narrows
    Given a path on the tip whose attributing ticket cannot be read
    When the replay builds its tip
    Then the replay refuses
    And the refusal names that path
    And no tip is advised for push

  # BL-1315 replay-tip-carries-only-the-landed-ticket-05
  Scenario: A tip with no entangled sibling is untouched
    Given the imported branch carries content of no other ticket
    When the replay builds its tip
    Then the tip is unchanged from the full delivered set
