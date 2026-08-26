# mutation-stamp: sha256=2e89744dde5c007bf0ab9b6d153be3f7bda5e1cd84af282c4439c1e51d3cda69
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-23T02:32:03.709638573Z","feature_name":"a ticket reaches backlog/active only through the promotion gates","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1083-every-promotion-path-goes-through-the-gate.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":1,"name":"a blocking gate refuses an expedited promotion","scenario_hash":"0d8b842e61d924af91513cd64faf71d55586a3ce2745fd10cafc95fda018818e","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-23T02:32:03.709638573Z"}]}
# acceptance-mutation-manifest-end

Feature: a ticket reaches backlog/active only through the promotion gates

  BL-1083: `promotion_gates_lib.bb` is described as the one chokepoint every
  promotion passes — hold marker, `human_approval`, `depends_on` (BL-957),
  then the depth cap, first failing gate wins. Only one caller actually goes
  through it: `promote_and_route_next.sh`.

  The extension host has its own way in. `promoteToActive` in
  `extension/src/panel/backlogWriter.ts` moves a file from `backlog/paused/`
  to `backlog/active/` and does nothing else — the module contains no
  reference to a gate, a dependency or an approval. Two live callers reach it:
  the Telegram Expedite verb and the paused-pager Expedite endpoint in
  `bridgeServer.ts`, whose own comment calls the semantics "force-promote".

  So the gate is a fence with a gap beside it, and the gap is on the path the
  operator uses from a phone. On 2026-08-22 BL-1078, BL-1079, BL-1080 and
  BL-1081 were promoted through it in one pass. BL-1078 declared
  `depends_on: [BL-713]` with BL-713 still active rather than in
  `backlog/done/` — a case `depends_on-refusal` is written to refuse by name.
  The coordinator parked three of them back by hand the same evening.

  This is a rules-duplication defect as much as a missing-call one. The gate
  logic is Babashka; the mover is TypeScript; no import crosses that boundary.
  Restating the rules on the TypeScript side would pass this feature and drift
  within weeks, so the scenarios ask for the verdict to be TAKEN from the
  shared chokepoint, and for no second copy of the rules to exist.

  Expedite stays a real verb. It records the human's approval before the gates
  are consulted, so `human_approval` is satisfied rather than skipped — the
  point is that a human tap may reorder work, never promote onto an unlanded
  dependency or out of a hold.

  # BL-1083 every-promotion-path-goes-through-the-gate-01
  Scenario: every path into active takes its verdict from the one chokepoint
    Given the sources that move a backlog ticket into the active folder
    When every such move is enumerated
    Then each one takes its verdict from the shared promotion-gates chokepoint
    And no second copy of the gate rules exists outside that chokepoint
    And more than one such path is found

  # BL-1083 every-promotion-path-goes-through-the-gate-02
  Scenario Outline: a blocking gate refuses an expedited promotion
    Given a paused ticket the promotion gates refuse for <gate>
    When the Expedite verb promotes it
    Then the ticket is still in paused afterwards
    And the operator is told which gate refused it and why

    Examples:
      | gate                      |
      | depends_on                |
      | hold                      |
      | active_backlog_max_depth  |

  # BL-1083 every-promotion-path-goes-through-the-gate-03
  Scenario: Expedite satisfies the approval gate rather than skipping it
    Given a paused ticket awaiting human approval that no other gate refuses
    When the Expedite verb promotes it
    Then the approval is recorded before the gates are consulted
    And the promotion is not refused for human approval
    And the ticket is in active afterwards
