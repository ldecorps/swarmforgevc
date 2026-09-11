Feature: BL-1532 A typed approve in the Approvals topic can name its ruling by letter

  The Approvals-topic reply grammar knows "approve <id>", "reject <id>
  <reason>", "/qjump <id>" and "/ambulance <id>"
  (extension/src/concierge/pendingApprovalReply.ts,
  classifyApprovalsTopicReply). It has no way to name a ruling. On a ticket
  that declares `ruling_options`, BL-1367 correctly refuses a typed
  "approve <id>" because consent without the answer would leave the coder
  guessing - so the human's only route is the button keyboard, and a bare
  typed approve records nothing. BL-1531 letters the options (A, B, ...)
  in the ask text and on the buttons; this slice makes that letter
  typeable: "approve BL-1529 A" records the ruling the letter names, with
  provenance `typed`, and approves. A letter that names no declared option,
  or a letter on a ticket that poses no choice, is refused and the reply
  says which letters exist - the swarm never interprets a guess.

  Background:
    Given a ticket pending human approval in the Approvals topic

  # BL-1532 a-typed-approve-names-its-ruling-by-letter-01
  Scenario Outline: a typed approve with a valid letter records that option as the ruling and approves
    Given the ticket declares ruling options A and B
    When the human types "<reply>" in the Approvals topic
    Then the ticket records the label of option A as its human ruling
    And the ticket records ruling provenance typed
    And the ticket records approval
    And the confirmation reply names the label of option A

    Examples:
      | reply             |
      | approve BL-1532 A |
      | approve bl-1532 a |

  # BL-1532 a-typed-approve-names-its-ruling-by-letter-02
  Scenario: a bare typed approve on a ticket posing a choice is refused and the reply names the letters
    Given the ticket declares ruling options A and B
    When the human types "approve BL-1532" in the Approvals topic
    Then the ticket is not approved
    And the ticket records no human ruling
    And the reply names the letters A and B as the options to choose from

  # BL-1532 a-typed-approve-names-its-ruling-by-letter-03
  Scenario: a letter that names no declared option is refused and nothing is recorded
    Given the ticket declares ruling options A and B
    When the human types "approve BL-1532 C" in the Approvals topic
    Then the ticket is not approved
    And the ticket records no human ruling
    And the reply names the letters A and B as the options to choose from

  # BL-1532 a-typed-approve-names-its-ruling-by-letter-04
  Scenario: a letter on a ticket that poses no choice is refused rather than interpreted
    Given the ticket declares no ruling options
    When the human types "approve BL-1532 A" in the Approvals topic
    Then the ticket is not approved
    And the reply says the ticket poses no choice and names the plain approve form

  # BL-1532 a-typed-approve-names-its-ruling-by-letter-05
  Scenario: a typed letter never overwrites a ruling already recorded
    Given the ticket declares ruling options A and B
    And the ticket already records option A as its human ruling
    When the human types "approve BL-1532 B" in the Approvals topic
    Then the recorded human ruling is unchanged
    And the reply names the recorded ruling

  # BL-1532 a-typed-approve-names-its-ruling-by-letter-06
  Scenario: the other Approvals-topic verbs are unchanged by the letter grammar
    Given the ticket declares ruling options A and B
    When the human types "reject BL-1532 not now" in the Approvals topic
    Then the ticket records rejection with the reason "not now"
    And the ticket records no human ruling
