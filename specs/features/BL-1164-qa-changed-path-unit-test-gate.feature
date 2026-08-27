Feature: QA changed-path unit test gate

  # BL-668 showed QA can pass while skipping unit tests mapped to changed
  # production paths. Article 4.5 and QA.prompt now require QA to run those
  # tests and bounce to coder when no test maps to a changed path.

  # BL-1164 constitution-article-4-5-present-01
  Scenario: Article 4.5 declares the changed-path unit test gate for QA
    Given the constitution article on quality gates at the parcel commit
    When Article 4 is read for changed-path obligations
    Then it requires QA to run mapped unit wiring or suite-manifest tests for each changed production path
    And it requires bouncing to coder when changed production code has no mapped automated test
    And it requires recording each changed-path command in the Article 4.4 inventory

  # BL-1164 qa-prompt-verification-order-02
  Scenario: QA.prompt names the changed-path gate in Verification Order
    Given swarmforge roles QA.prompt at the parcel commit
    When the Verification Order section is read
    Then it instructs QA to diff the parcel against origin main for changed production files
    And it instructs QA to run mapped unit or wiring tests from suite-manifest.tsv and repo conventions
    And it names bouncing to coder with failureClass unit when no test maps to a changed path
    And it cites test_handoffd_one_shot_flags_parse.sh as the handoffd.bb example

  # BL-1164 documenter-how-to-03
  Scenario: an operator how-to documents QA changed-path inventory steps
    Given the documenter corpus at the parcel commit
    When docs are searched for changed-path QA inventory guidance
    Then a how-to page explains manifest grep and the narrowest command per changed path
    And that page explains bouncing to coder when a changed production path has no mapped test
    And that page explains recording RUN or BLOCKED BY for each changed-path command in bounce evidence
