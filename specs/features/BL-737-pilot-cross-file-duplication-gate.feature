Feature: Pilot land gate refuses cross-file mechanical duplication in the run's own touched files

  # BL-737: BL-637's landing commit pasted the same 12-line --help heredoc into
  # 16 lifecycle scripts in one sitting. Nothing on /pilot's landing path checked
  # for that shape before backlog/done/. Extend the BL-727 gate (same
  # landPilotedTicket owner as BL-729/BL-731) with a cross-file duplication
  # check scoped to files the run's own non-merge commits touched.

  Background:
    Given a piloted ticket whose declared acceptance contract has just passed

  # BL-737 cross-file-dup-01
  Scenario: Identical text pasted into more than two touched files refuses the land
    Given the run's commits touched three shell scripts
    And the same twelve-line help block appears verbatim in each of those three files
    When the pilot runs the landing gate
    Then the land is refused for cross-file duplication
    And the refusal names at least two of the affected files

  # BL-737 cross-file-dup-02
  Scenario: The same block in only two touched files does not refuse the land
    Given the run's commits touched two shell scripts
    And the same twelve-line help block appears verbatim in each of those two files
    When the pilot runs the landing gate
    Then the land is completed

  # BL-737 cross-file-dup-03
  Scenario: A refused duplication land writes nothing durable
    Given the run's commits touched three shell scripts with a shared duplicated block
    When the pilot runs the landing gate
    Then the land is refused for cross-file duplication
    And the ticket yaml stays where it was
    And no acceptance receipt is written

  # BL-737 cross-file-dup-04
  Scenario: The duplication check considers only files the run's commits touched
    Given an identical help block already exists in an untouched script outside the run
    And the run's commits touched two scripts that share a new duplicated block
    When the pilot runs the landing gate
    Then the land is completed

  # BL-737 cross-file-dup-05
  Scenario: Unreadable touched-file history lets the land through with a warning
    Given the gate cannot resolve which files the run's commits touched
    When the pilot runs the landing gate
    Then the land is completed
    And the outcome warns that cross-file duplication was not checked
