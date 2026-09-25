# mutation-stamp: sha256=c6bf0ca44fc1c112619fb80c511b94c770b4a7456cf540591d955902c992ac82
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-25T16:44:02.940517151Z","feature_name":"BL-1698 the local parcel driver survives a restart, releases its hold and handles merge-only mail","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1698-the-local-parcel-driver-survives-a-restart-releases-its-hold-and-handles-merge-only-mail.feature","background_hash":"60f0d55e6ec02564e7176ae94782e788be163f65ae077a09a5b4525428e556e1","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a driver restarted mid-parcel resumes from its recorded step","scenario_hash":"95e402f798970c07a4c4f8c4e1d45c56988be9e66b434e61749825b526c0a736","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-25T16:44:02.940517151Z"},{"index":2,"name":"an operator release ends a hold without a model turn","scenario_hash":"130cadb6729f913e1f2ab9351d29df7864e0f6704f5f52a0bb4db1d4b3c227cf","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-25T16:44:02.940517151Z"},{"index":3,"name":"mail that needs no model turn is merged and completed mechanically","scenario_hash":"91c6eb32ff3464808fcaafa856d0b81f3ee28dd0fbb78432b51f30ffb5615acb","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-25T16:44:02.940517151Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1698 the local parcel driver survives a restart, releases its hold and handles merge-only mail

  BL-1697's driver runs one coder parcel end to end, holds a parcel it
  escalated, and leaves everything else to later. This slice makes it
  safe to live with. A driver or seat restart in the middle of a parcel
  resumes from the recorded step instead of re-merging, re-instructing or
  leaving the spec unwritable. A held parcel is released by the human's
  answer or by an explicit operator release. Mail that needs no model
  turn - a QA merge-up note, a non-forwarding reverse copy - is merged and
  completed mechanically, and any other note is passed to the human and
  completed so it never wedges the seat. babysitterd's nudges stop
  reaching a driver seat, the same way handoffd's own did in BL-1697.

  Background:
    Given a throwaway project whose coder seat is an aider seat under the driver
    And an active ticket BL-9 whose acceptance feature fails before any edit

  # BL-1698 the-local-parcel-driver-survives-a-restart-01
  Scenario Outline: a driver restarted mid-parcel resumes from its recorded step
    Given the driver's record for BL-9 says it stopped <after>
    And the stand-in model commits an edit that makes the acceptance feature pass
    When the driver starts again
    Then the ticket's spec files are writable before any other step runs
    And the parcel commit is merged exactly once
    And the pane received the instruction <instructions>
    And a git_handoff for BL-9 naming the model's commit is queued to the next pipeline role

    Examples:
      | after                                        | instructions |
      | after the merge and before the chat set      | once         |
      | during the model turn with the spec unwritable | never again  |

  # BL-1698 the-local-parcel-driver-survives-a-restart-02
  Scenario: the human's answer to an escalation becomes one more fix request
    Given the driver escalated BL-9 with "acceptance still failing" and holds it
    And the human's answer to that question is waiting for the coder
    And the stand-in model commits an edit that makes the acceptance feature pass
    When the driver runs its next pass
    Then the answer is consumed through the role-answer delivery path
    And the pane received one fix request carrying the answer text
    And a git_handoff for BL-9 naming the model's commit is queued to the next pipeline role

  # BL-1698 the-local-parcel-driver-survives-a-restart-03
  Scenario Outline: an operator release ends a hold without a model turn
    Given the driver escalated BL-9 with "acceptance still failing" and holds it
    When the operator releases the coder's hold with "<mode>"
    Then the hold ends as "<result>"
    And the pane received no new text

    Examples:
      | mode     | result                                          |
      | complete | parcel completed, no git_handoff queued         |
      | retry    | record cleared, served afresh on the next pass  |

  # BL-1698 the-local-parcel-driver-survives-a-restart-04
  Scenario Outline: mail that needs no model turn is merged and completed mechanically
    Given the coder's next mail is <mail>
    When the driver runs its next pass
    Then the checkout holds a merge of that mail's commit
    And the mail is completed with no git_handoff queued and no text typed into the pane

    Examples:
      | mail                                                        |
      | a QA merge-up note naming a QA-approved commit              |
      | a non-forwarding git_handoff reverse copy from the cleaner  |

  # BL-1698 the-local-parcel-driver-survives-a-restart-05
  Scenario: any other note is passed to the human and completed
    Given the coder's next mail is a note from the specifier reading "BL-9 amended, merge main"
    When the driver runs its next pass
    Then exactly one question is raised for the coder quoting the note's sender and text
    And the mail is completed with no git_handoff queued and no text typed into the pane

  # BL-1698 the-local-parcel-driver-survives-a-restart-06
  Scenario: babysitterd nudges a Claude seat and never a driver seat
    Given babysitterd finds both the coder's aider pane and a Claude seat's pane idle with work
    When babysitterd runs its nudge pass
    Then the coder's aider pane received no text from it
    And the Claude seat's pane received the same nudge as before this ticket
