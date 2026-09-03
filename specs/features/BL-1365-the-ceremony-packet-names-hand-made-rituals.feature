Feature: The ceremony packet names hand-made rituals

  The closing ceremony already turns a mechanically-computed packet into a
  recorded process outcome: the coordinator brings numbers, the specifier turns
  them into a ticket, a spec tweak, or a reasoned no-change. The 2026-09-03
  determinism sweep produced exactly that kind of evidence and was done by hand.

  It need not be. A ritual performed by a script collapses to one commit
  subject; a ritual performed by an agent has a long tail of them. Measured on
  real history: promotion's 484 commits share one generated subject and the
  topic store's 2228 share another, while the evidence file's most repeated
  subject appears 29 times across 2182 commits. That ratio is computable.

  Two failure modes bound the design. A packet that restates the same standing
  candidates every shift becomes the alert nobody reads. And a candidate is
  evidence for a ticket, never a ticket — the minting judgement stays the
  specifier's.

  Background:
    Given the ritual ledger has classified a window of commits

  # BL-1365 the-ceremony-packet-names-hand-made-rituals-01
  Scenario: a ritual dominated by one commit subject is not a candidate
    Given a ritual class whose commits nearly all share one subject
    When the packet is assembled
    Then that class is not offered as a candidate

  # BL-1365 the-ceremony-packet-names-hand-made-rituals-02
  Scenario: a high-volume ritual with many different subjects is a candidate
    Given a ritual class above the volume threshold whose subjects vary widely
    When the packet is assembled
    Then that class is offered as a candidate
    And the candidate carries its volume and its subject spread

  # BL-1365 the-ceremony-packet-names-hand-made-rituals-03
  Scenario: a ritual already named by an open ticket is not offered again
    Given a ritual class an open ticket already names
    When the packet is assembled
    Then that class is not offered as a candidate

  # BL-1365 the-ceremony-packet-names-hand-made-rituals-04
  Scenario: a window with no new candidate says so
    Given every ritual class is scripted or already ticketed
    When the packet is assembled
    Then no candidate is offered
    And the ceremony can record a reasoned no-change

  # BL-1365 the-ceremony-packet-names-hand-made-rituals-05
  Scenario: a ceremony that never runs loses no measurement
    Given the ritual ledger has classified a window of commits
    And no ceremony runs for that window
    When a later ceremony assembles its packet
    Then the earlier window's candidates are still offered
