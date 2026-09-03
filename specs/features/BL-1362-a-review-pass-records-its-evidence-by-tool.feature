Feature: A review pass records its evidence by tool

  Article 4.4 requires every review pass to leave one evidence file: items
  D1..Dn with their fixed fields, or an explicit NONE for a clean sweep, and
  the forward must name the commit that carries it rather than the bare
  received hash.

  There is a gate for this and no writer. `review_forward_evidence_gate_lib.bb`
  refuses a forward whose commit contributed nothing, and it has been hardened
  three times - BL-536, BL-806, then BL-1293 - each after a role forwarded a
  pass with no evidence behind it. Every role still hand-derives the filename,
  hand-writes the structure and hand-commits it.

  Measured over 45 days: 2182 of 12903 non-merge commits carry nothing but a
  `backlog/evidence/` file, and their subjects are all different, which is the
  signature of each one being composed from scratch.

  The tool records; it never judges. The verdict and the defect items are the
  reviewing role's, and an inventory that is neither NONE nor D1..Dn is refused
  rather than guessed at.

  Background:
    Given a reviewing role has finished its pass on a ticket

  # BL-1362 a-review-pass-records-its-evidence-by-tool-01
  Scenario: a clean sweep is recorded as an explicit NONE
    Given the pass found no defect
    When the role records its evidence
    Then the evidence file records NONE
    And the evidence file is committed
    And the commit is reported for the role to forward

  # BL-1362 a-review-pass-records-its-evidence-by-tool-02
  Scenario: a defect inventory is recorded item by item
    Given the pass found two defects
    When the role records its evidence
    Then the evidence file lists both items
    And each item carries its blamed role and remediation pointer
    And the evidence file is committed

  # BL-1362 a-review-pass-records-its-evidence-by-tool-03
  Scenario: an inventory that is neither NONE nor a defect list is refused
    Given the pass supplied no verdict
    When the role records its evidence
    Then the recording is refused naming what a verdict must be
    And no evidence file is written

  # BL-1362 a-review-pass-records-its-evidence-by-tool-04
  Scenario: the recorded commit satisfies the review-forward evidence gate
    Given the pass found no defect
    When the role records its evidence
    And the role forwards the reported commit
    Then the review-forward evidence gate does not refuse the forward

  # BL-1362 a-review-pass-records-its-evidence-by-tool-05
  Scenario Outline: every reviewing role records to the same convention
    Given the pass found no defect
    And the reviewing role is <role>
    When the role records its evidence
    Then the evidence file is named for the ticket the role and the date

    Examples:
      | role       |
      | cleaner    |
      | architect  |
      | hardender  |
      | documenter |
      | QA         |
