Feature: BL-1683 The merge-drop guard maps renames and judges a renamed path by its content at the new path
  The send-time merge-drop guard reads dropped hunks per path string, so a
  file the forwarding branch renamed (a backlog promotion moves a ticket
  from paused to active with one added line) reads as every line dropped
  when the received branch still holds the old path. This feature is that
  a rename which keeps every uncontested hunk is not a drop, and that a
  rename which loses one is still refused, naming the new path.

  Background:
    Given a fixture repository with a main branch, a received branch and a forwarding branch
    And the received branch adds "backlog/paused/BL-0001-ticket.yaml" with twenty lines
    And main promotes that file to "backlog/active/BL-0001-ticket.yaml" appending one line
    And the forwarding branch merges main and then merges the received branch

  # BL-1683 a-content-preserving-rename-is-not-a-drop-01
  Scenario: a promotion's rename that keeps every received line is not reported as a drop
    When the merge-drop guard judges a forward of the merged tip against the received tip
    Then it reports no blocking finding
    And the send is not refused

  # BL-1683 a-rename-that-loses-a-hunk-is-still-refused-02
  Scenario: a rename whose new-path content lost one of the received side's uncontested lines is refused at the new path
    Given the forwarding branch's merge also dropped three of the received side's twenty lines from the active copy
    When the merge-drop guard judges a forward of the merged tip against the received tip
    Then it reports one blocking finding of three lines
    And the finding names "backlog/active/BL-0001-ticket.yaml"
