Feature: the specifier keeps every new backlog item epic-bound and every new epic milestone-bound

  # Human directive 2026-07-20: when speccing, a slice without an epic must get one assigned;
  # when creating an epic tracker, a milestone must be set (created if none fits). Schema +
  # backlog_epic_milestone_audit.bb already require this on the open backlog; this ticket makes
  # the specifier's write path fail loud before handoff instead of relying on a later audit.

  Background:
    Given the specifier is writing a paused backlog item into backlog/paused/

  # BL-544 assign-epic-on-slice-01
  Scenario: a specced slice without an epic must get an epic assigned before handoff
    Given the specifier is speccing a non-epic backlog item
    And the resulting YAML has no epic field
    When the specifier runs the backlog hygiene gate on that item
    Then the gate fails and names the missing epic
    When the specifier assigns a non-empty epic to the item
    And runs the backlog hygiene gate again
    Then the gate passes

  # BL-544 epic-gets-milestone-02
  Scenario: a newly created epic tracker without a milestone must get one before handoff
    Given the specifier is creating a type epic tracker
    And the resulting YAML has no milestone field
    When the specifier runs the backlog hygiene gate on that item
    Then the gate fails and names the missing milestone
    When the specifier sets a non-empty milestone on the epic tracker
    And runs the backlog hygiene gate again
    Then the gate passes
