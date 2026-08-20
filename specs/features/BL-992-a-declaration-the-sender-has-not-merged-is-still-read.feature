Feature: A declaration the sender has not merged is still read

  The router reads a ticket's required_stages from the SENDER'S OWN working
  tree. A worktree that has not merged the promotion has no copy of the
  ticket in backlog/active at all, so the declaration is invisible and every
  decision that depends on it silently takes the no-declaration path.

  The window is not rare. Measured on main 2026-08-20, all 7 active tickets
  declared required_stages and 2 of them - BL-969 and BL-970 - were absent
  from all six pipeline worktrees. It is also worst exactly when work is
  youngest, because promotion into backlog/active is itself a main-side move
  the sender must merge before it sees anything.

  Background:
    Given required_stages routing is enabled

  # BL-992 unmerged-declaration-still-prunes-01
  Scenario: A declaration carried only by the ref still prunes an undeclared stage
    Given the ticket's committed declaration is required_stages coder-qa
    And the sender's working tree has no copy of the ticket
    When the coder sends a git_handoff addressed to cleaner
    Then the parcel is delivered to QA and to no other role

  # BL-992 unmerged-invalid-declaration-is-still-surfaced-02
  Scenario: An invalid declaration carried only by the ref is still surfaced
    Given the ticket's committed declaration is required_stages invalid
    And the sender's working tree has no copy of the ticket
    When the coder sends a git_handoff addressed to QA
    Then the recorded skip carries the rejection reason for that declaration

  # BL-992 no-resolvable-ref-falls-back-to-the-working-tree-03
  Scenario: With no resolvable ref the working tree copy is still used
    Given no main ref resolves in the sender's root
    And the sender's working tree declares required_stages coder-qa
    When the coder sends a git_handoff addressed to cleaner
    Then the parcel is delivered to QA and to no other role

  # BL-992 ticket-in-neither-place-delivers-as-addressed-04
  Scenario: A ticket present in neither the ref nor the working tree delivers as addressed
    Given the ticket is absent from every ref and from the working tree
    When the coder sends a git_handoff addressed to QA
    Then the parcel is delivered to QA and to no other role
    And the send exits successfully

  # BL-992 exact-id-match-survives-the-ref-lookup-05
  Scenario: The ref lookup matches a ticket by its own id field, not by filename prefix
    Given the ref carries a ticket "BL-9005" declaring required_stages coder-qa
    And the ref carries no ticket "BL-900"
    When the coder sends a git_handoff for "BL-900" addressed to cleaner
    Then the parcel is delivered to cleaner and to no other role
