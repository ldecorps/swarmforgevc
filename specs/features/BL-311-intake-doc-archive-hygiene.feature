Feature: Dispositioned intake docs are archived instead of sitting undeleted forever

  # BL-311 intake-doc-archive-01
  Scenario: a dispositioned intake doc is archived
    Given an INTAKE-*.md file whose corresponding ticket is already in backlog/done/
    When the archive-on-disposition pass runs
    Then the file is moved into .swarmforge/operator/archive/

  # BL-311 intake-doc-archive-02
  Scenario: an undispositioned intake doc is left in place
    Given an INTAKE-*.md file whose corresponding ticket is not yet done
    When the archive-on-disposition pass runs
    Then the file remains in .swarmforge/operator/

  # BL-311 intake-doc-archive-03
  Scenario: the convention is documented, not just performed once
    Given the archive-on-disposition pass has run
    When a role prompt is checked for the intake-doc convention
    Then the prompt documents moving a dispositioned intake doc to .swarmforge/operator/archive/
