Feature: the hygiene gate's duplicate-id check compares a subject against itself correctly regardless of path form

  # BL-1194 (epic none — standalone tooling fix; discovered 2026-08-27 while
  # minting BL-1193). specifier_backlog_hygiene_gate.bb's duplicate-id check
  # (BL-1105) builds the local corpus index from an ABSOLUTE backlog-root
  # (repo-root/backlog), so every path in that index is absolute. A subject
  # passed to the CLI as a path RELATIVE to the working directory (the
  # natural, documented invocation: `specifier_backlog_hygiene_gate.sh
  # backlog/paused/<file>.yaml`, run from the repo root) never string-equals
  # its own absolute corpus entry, so `other-holders` fails to exclude the
  # subject from its own id's holder list and reports the file as a
  # duplicate of itself.

  Background:
    Given a backlog corpus the hygiene gate reads ticket ids from
    And the corpus does not contain "BL-4242" locally

  # BL-1194 relative-path-self-not-a-duplicate-01
  Scenario: A brand-new ticket passed by a working-directory-relative path is not reported as its own duplicate
    When the specifier runs the hygiene gate on a new ticket whose id is "BL-4242" using a "relative" path
    Then the gate does not report a duplicate ticket id

  # BL-1194 relative-path-genuine-duplicate-still-caught-02
  Scenario Outline: A genuine duplicate is still caught regardless of the path form used to invoke the gate
    Given the corpus already contains a ticket with id "BL-4242" in "paused"
    When the specifier runs the hygiene gate on a new ticket whose id is "BL-4242" using a "<path_form>" path
    Then the gate fails
    And the output reports a duplicate ticket id

    Examples:
      | path_form |
      | relative  |
      | absolute  |
