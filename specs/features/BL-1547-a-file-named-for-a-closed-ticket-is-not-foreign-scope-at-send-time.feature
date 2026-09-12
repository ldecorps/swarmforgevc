Feature: BL-1547 A file named for a closed ticket is not foreign scope at send time

  The send-time task-scope gate (BL-1192) maps a changed path under
  backlog/, specs/features/ or docs/how-to/ to the ticket id in its own
  basename and refuses a task-tagged commit touching a path mapped to any
  other ticket. It never asks whether that ticket is still open, yet a
  shipped ticket's how-to and feature narrative are maintained by whoever
  later changes what they describe. On 2026-09-12 the documenter, editing
  BL-1518-a's how-to and feature comment as BL-1537's own task 4, had to
  drop BL-1537 from the subject to pass this gate (evidence ed9bcc56ce),
  and the land step then credited the commit to closed BL-1518 and dropped
  both paths (BL-1546). A basename naming a ticket whose YAML is filed
  under backlog/done/ on the freshest ref is not a foreign finding; one
  naming a ticket under active/, paused/ or hold/, or found nowhere, is
  refused exactly as before. Every scenario runs against a fixture
  repository under mkdtemp with its own origin (BL-1390).

  Background:
    Given a fixture repository with an origin, a main branch, a role branch, a task ticket, and a foreign ticket whose how-to file exists on origin/main

  # BL-1547 a-closed-tickets-file-is-not-a-foreign-finding-01
  Scenario: a task-tagged commit touching a how-to named for a ticket filed under backlog/done/ is accepted
    Given the foreign ticket's YAML is filed under backlog/done/ on origin/main
    And a commit on the role branch leading with the task ticket's id that edits the foreign ticket's how-to
    When the task-scope gate evaluates a git_handoff for the task ticket at that commit
    Then the gate accepts with no foreign-scope finding for that path

  # BL-1547 an-open-tickets-file-is-still-refused-02
  Scenario: the same commit is refused when the foreign ticket is filed under backlog/active/
    Given the foreign ticket's YAML is filed under backlog/active/ on origin/main
    And a commit on the role branch leading with the task ticket's id that edits the foreign ticket's how-to
    When the task-scope gate evaluates a git_handoff for the task ticket at that commit
    Then the gate refuses naming that path and the foreign ticket's id, exactly as before this ticket

  # BL-1547 an-absent-ticket-is-not-closed-03
  Scenario: the same commit is refused when the foreign ticket's YAML is found in no backlog folder
    Given the foreign ticket's YAML is absent from every backlog folder on origin/main
    And a commit on the role branch leading with the task ticket's id that edits the foreign ticket's how-to
    When the task-scope gate evaluates a git_handoff for the task ticket at that commit
    Then the gate refuses naming that path and the foreign ticket's id
