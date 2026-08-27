# mutation-stamp: sha256=dde57172706eb2c99b553fbe1f5fff5038c295688ccc95e8e697d665f306328b
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T09:55:59.445630395Z","feature_name":"An active ticket with no real assignee reaches the coordinator","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1093-an-active-ticket-with-no-real-assignee-strands-between-two-sweeps.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"A value that names nobody makes a ticket unassigned","scenario_hash":"9c31da9ae49eae659347bba4178a13294b4eb33eb6c00c7459bca099ff0b881e","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-24T09:55:59.445630395Z"}]}
# acceptance-mutation-manifest-end

Feature: An active ticket with no real assignee reaches the coordinator

  Two sweeps divide the active backlog between them. The dispatch-gap sweep
  auto-routes a ticket to its assignee; the unassigned-active sweep nudges
  the coordinator about a ticket that has none. A ticket whose assigned_to
  names nobody in words - `none`, `unassigned`, or blank - satisfies neither:
  the first emits a recipient the handoff validator rejects, and the second
  looks for a MISSING field and does not see it.

  So it strands, invisibly, while the daemon retries every few seconds.

  # BL-1093 nobody-assignee-01
  Scenario Outline: A value that names nobody makes a ticket unassigned
    Given an active ticket whose assigned_to is <spelling>
    And that ticket has no dispatch trail
    When the daemon runs its active-backlog sweeps
    Then the coordinator is nudged about the ticket
    And no handoff is addressed to it by name

    Examples:
      | spelling       |
      | absent         |
      | blank          |
      | the word none  |
      | unassigned     |

  # BL-1093 nobody-assignee-02
  Scenario: A real assignee still receives its auto-route
    Given an active ticket assigned to the coder
    And that ticket has no dispatch trail
    When the daemon runs its active-backlog sweeps
    Then the ticket is auto-routed to the coder

  # BL-1093 nobody-assignee-03
  Scenario: Every active ticket is claimed by exactly one sweep
    Given a set of active tickets covering every assigned_to spelling in use
    When the daemon runs its active-backlog sweeps
    Then no ticket is claimed by both sweeps
    And no ticket is claimed by neither

  # BL-1093 nobody-assignee-04
  Scenario: The daemon never emits a recipient the validator would reject
    Given an active ticket whose assigned_to names nobody
    When the daemon builds an auto-route draft for it
    Then no draft naming that value as recipient is produced

  # BL-1093 nobody-assignee-05
  Scenario: A failed auto-route records why it failed
    Given an auto-route that the handoff validator rejects
    When the daemon logs the failure
    Then the log line states the validator's reason
