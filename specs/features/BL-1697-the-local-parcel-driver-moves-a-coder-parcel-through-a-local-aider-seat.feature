Feature: BL-1697 the local parcel driver moves a coder parcel through a local aider seat

  An aider seat cannot run the pipeline lifecycle itself, and a 7B model
  cannot hold a multi-step procedure even when told the steps (overnight
  lab, 2026-09-24). The driver runs inside handoffd for seats whose
  provider carries the parcel-driver capability: it serves and merges the
  parcel, sets up the chat with the ticket and its acceptance feature
  read-only and physically unwritable, sends the model one instruction,
  and gates the result. Only a red-to-green acceptance run, a model
  commit and a byte-identical spec earn a handoff; anything else ends in
  one escalation that names the condition that failed. These scenarios
  use a fake pane and a scripted stand-in for the model; no model runs.

  Background:
    Given a throwaway project whose coder seat is an aider seat under the driver
    And an active ticket BL-9 whose acceptance feature fails before any edit
    And a git_handoff parcel for BL-9 waits in the coder's inbox

  # BL-1697 the-local-parcel-driver-moves-a-coder-parcel-01
  Scenario: a model edit that turns the acceptance green is handed to the next role
    Given the stand-in model commits an edit that makes the acceptance feature pass
    When the driver runs the parcel to the end
    Then the coder's checkout holds a merge of the parcel commit followed by the model's commit
    And a git_handoff for BL-9 naming the model's commit is queued to the next pipeline role
    And the parcel is completed
    And the ticket's spec files are writable again

  # BL-1697 the-local-parcel-driver-moves-a-coder-parcel-02
  Scenario Outline: a failed gate escalates once, names the failed condition and hands nothing off
    Given the stand-in model <behaviour>
    When the driver runs the parcel to the end
    Then exactly one question is raised for the coder naming BL-9 and "<condition>"
    And no git_handoff for BL-9 is queued and the parcel stays in process
    And the ticket's spec files are writable again

    Examples:
      | behaviour                                                          | condition                  |
      | commits an edit that leaves the acceptance failing on every turn   | acceptance still failing   |
      | makes no commit                                                    | no model commit            |
      | commits a change to the acceptance feature and a passing edit      | spec changed               |

  # BL-1697 the-local-parcel-driver-moves-a-coder-parcel-03
  Scenario: the driver gives up only after the configured number of fix turns
    Given the pack sets the seat fix-turn limit to 2
    And the stand-in model commits an edit that leaves the acceptance failing on every turn
    When the driver runs the parcel to the end
    Then the pane received the instruction once and a fix request twice before the question was raised

  # BL-1697 the-local-parcel-driver-moves-a-coder-parcel-04
  Scenario Outline: a parcel that cannot start escalates before any model turn
    Given the parcel is set up so that <precondition>
    When the driver runs the parcel to the end
    Then exactly one question is raised for the coder naming BL-9 and "<condition>"
    And the pane never received the instruction and no merge is in progress

    Examples:
      | precondition                                         | condition                         |
      | the acceptance feature for BL-9 already passes       | acceptance passed before any edit |
      | the parcel commit conflicts with the coder's checkout | merge conflict                    |

  # BL-1697 the-local-parcel-driver-moves-a-coder-parcel-05
  Scenario: the spec is unwritable during the model turn and the instruction carries no suffix
    Given the stand-in model commits an edit that makes the acceptance feature pass
    When the driver sends the model its instruction
    Then the ticket file and its acceptance feature have no write permission
    And the chat was given the ticket and the acceptance feature read-only before the instruction
    And the instruction text contains no aider no-narration suffix

  # BL-1697 the-local-parcel-driver-moves-a-coder-parcel-06
  Scenario Outline: handoffd types nothing of its own into a driver seat and still wakes other seats
    When handoffd sends its <injection> to every seat with work
    Then the coder's aider pane received no text from it
    And a Claude seat with work received the same text as before this ticket

    Examples:
      | injection             |
      | new-mail wake         |
      | chase poke            |
      | in-process resume     |
