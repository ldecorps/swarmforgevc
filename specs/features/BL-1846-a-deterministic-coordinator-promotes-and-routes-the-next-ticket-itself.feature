Feature: BL-1846 a deterministic coordinator promotes and routes the next ticket itself

  On a mono-router pack the happy path already runs without a model
  coordinator except at one hop: the forward rotation is a script
  (mono_router_lib forward-rotate-target) and the post-QA close is a
  script (handoffd's landed auto-close), but when the land frees a slot
  handoffd only drops an open-slot note on the coordinator, and a model
  must read it and run promote_and_route_next.sh. A pack that declares
  "config coordinator_mode deterministic" has handoffd run that same
  gated script itself instead, so a green ticket is followed by the next
  one reaching the coder with no model turn. A pack that declares no
  coordinator mode keeps today's note, cooldown and escalation.

  Background:
    Given a scratch project with one open active slot under the depth cap

  # BL-1846 deterministic-coordinator-promotes-01
  Scenario: a deterministic coordinator promotes and routes the next ticket itself
    Given the pack declares the deterministic coordinator mode
    And an approved paused ticket the promotion gates allow
    When handoffd runs its open-slot sweep once
    Then that ticket is in the active backlog
    And the coder's mailbox holds a work parcel for that ticket
    And the coordinator's mailbox holds no open-slot note

  # BL-1846 deterministic-coordinator-promotes-02
  Scenario: a pack that declares no coordinator mode still gets today's open-slot note
    Given the pack declares no coordinator mode
    And an approved paused ticket the promotion gates allow
    When handoffd runs its open-slot sweep once
    Then that ticket is still in the paused backlog
    And the coordinator's mailbox holds an open-slot note naming that ticket

  # BL-1846 deterministic-coordinator-promotes-03
  Scenario: a refused promotion stays paused and reaches the operator at the escalation threshold
    Given the pack declares the deterministic coordinator mode
    And the only paused ticket awaits human approval
    When handoffd runs its open-slot sweep on as many ticks as the escalation threshold
    Then that ticket is still in the paused backlog
    And the coordinator's mailbox holds no open-slot note
    And one operator alert names that ticket and the gate that refused it

  # BL-1846 deterministic-coordinator-promotes-04
  Scenario: an engaged ambulance freezes the deterministic promotion too
    Given the pack declares the deterministic coordinator mode
    And an approved paused ticket the promotion gates allow
    And ambulance mode is engaged
    When handoffd runs its open-slot sweep once
    Then that ticket is still in the paused backlog
