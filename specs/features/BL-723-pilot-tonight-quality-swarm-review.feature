Feature: Live swarm reviews tonight's pilot-landed defect quality
  After an offline pilot closed a batch of low-mutation defects, the next
  morning live swarm must queue-jump a review and say whether those landings
  meet normal live-swarm quality. Source: human via Let's Talk 2026-07-30;
  BL-723.

  Background:
    Given the done tickets listed as tonight's primary pilot review set
    And this parcel is queue-jumped into the live swarm (not the expeditor)

  # BL-723 review-01
  Scenario: every primary ticket gets a quality look
    When the live swarm completes BL-723
    Then each of BL-718, BL-627, BL-636, BL-637, BL-641, BL-642, BL-646, BL-623, BL-671, BL-694, BL-559, BL-661, and BL-662 has been reviewed against live-swarm standards

  # BL-723 review-02
  Scenario: explicit on-par verdict is recorded
    When the review finishes
    Then a human-readable verdict states on par or not on par
    And the verdict names reasons against normal live coder-through-qa expectations

  # BL-723 review-03
  Scenario: shortfalls file both remaining-work and pilot-process defects
    When a reviewed landing falls short of live-swarm quality
    Then a detailed remaining-work defect is filed for what is still wrong or unfinished
    And a pilot-process defect is also filed
    And the pilot-process defect names what the pilot missed or which gate should have caught it
    And the goal of that pilot-process defect is to make the next pilot run stronger
    And the original done ticket is not silently rewritten unless a true revert is warranted

  # BL-723 review-04
  Scenario: verdicts are written back onto reviewed tickets
    When the review finishes
    Then each primary reviewed done ticket has its on-par or not-on-par verdict recorded back on that ticket
    And any new remaining-work or pilot-process defects are pointed to from that ticket

  # BL-723 review-05
  Scenario: this review is not run as offline pilot
    When BL-723 is executed
    Then it walks the live swarm path after queue-jump
    And it is not driven by the offline expeditor or /pilot for this parcel

  # BL-723 review-06
  Scenario: detailed multi-hat email reaches the human
    When the live swarm completes BL-723
    Then an email is sent to the configured notify recipient
    And the email has separate sections for coder, cleaner, architect, hardender, documenter, and QA viewpoints
    And the QA section is the most detailed
    And the email states the overall on-par or not-on-par verdict with reasons

  # BL-723 review-07
  Scenario: coder and cleaner seats actually review
    When BL-723 walks required_stages
    Then coder and cleaner each perform a real review pass
    And their viewpoints in the email come from those seats not from a later seat inventing them
