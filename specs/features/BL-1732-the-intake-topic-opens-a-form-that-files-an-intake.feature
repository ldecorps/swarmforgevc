Feature: BL-1732 The Intake topic opens a form that files an intake in the shared vocabulary

  The human files new intakes from the phone, in one ubiquitous language. A
  standing "Intake" forum topic, answering only the principal, opens a
  Mini App form. The form states the goal as a narrative, "As <actor>, I
  want to <action>, so I can <goal>", with each slot a dropdown over a
  shared vocabulary seeded with a starter list. Any slot can take a new
  value, which joins the shared list only when an intake using it is
  submitted. Below the narrative go one or more free-text Given/When/Then
  scenarios and optional notes. Submit writes an INTAKE file at the backlog
  root, the specifier's usual queue, and the topic confirms it with the
  file's permalink.

  Background:
    Given the shared vocabulary holds the starter list

  # BL-1732 the-narrative-slots-offer-the-shared-vocabulary-01
  Scenario Outline: each narrative slot offers the shared vocabulary
    When I open a new draft from the Intake topic
    Then the <slot> dropdown offers "<value>"

    Examples:
      | slot   | value                                       |
      | actor  | the human                                   |
      | action | file a new intake from my phone             |
      | goal   | keep the backlog in one ubiquitous language |

  # BL-1732 an-added-value-is-mine-until-i-submit-02
  Scenario: a value I add is offered in my draft but not yet shared
    When I add the actor "a night-shift reviewer" to my draft
    Then my draft's actor dropdown offers "a night-shift reviewer"
    And the shared vocabulary does not hold "a night-shift reviewer"

  # BL-1732 submitting-shares-the-drafts-new-values-03
  Scenario: submitting shares the draft's new values
    Given my draft uses the new goal "sleep through the night"
    When I submit the draft
    Then a new draft's goal dropdown offers "sleep through the night"

  # BL-1732 submit-puts-the-intake-in-the-usual-queue-04
  Scenario: Submit puts the intake at the backlog root and the topic confirms it
    Given a draft with a narrative and one scenario
    When I submit the draft
    Then an INTAKE file holding the narrative and the scenario is at the backlog root
    And the Intake topic confirms it with the file's permalink

  # BL-1732 an-unreachable-form-is-said-05
  Scenario: an unreachable form is said, not a dead button
    Given the tunnel serving the form is down
    When I ask the Intake topic for the form
    Then the topic replies that the form is unreachable and why

  # BL-1732 only-the-principal-files-06
  Scenario: a submit without the bridge's device token is refused
    Given a draft with a narrative and one scenario
    When the draft is submitted without the bridge's device token
    Then the submit is refused
    And no INTAKE file is written
