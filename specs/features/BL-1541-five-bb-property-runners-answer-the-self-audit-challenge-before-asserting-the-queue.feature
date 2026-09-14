Feature: BL-1541 Five bb property runners answer the self-audit challenge before asserting the queue

  Since 44d2d42591 (2026-08-30) the first swarm_handoff.bb invocation of a
  git_handoff draft is answered with the self-audit challenge - AUDIT_REQUIRED,
  HANDOFF_NOT_QUEUED, exit 0, nothing queued - and only the identical second
  invocation queues. Five bb property runners predate that landing, send once and
  assert the queue: bl983 accounts for zero parcels every draw, bl982 finds no
  parcel in the bare seat's inbox, bl992 dies on the challenge text, bl991 and
  bl951 slurp a queued file the CLI never named. The audit itself is right
  (BL-1306, BL-1529 defend it); the runners are stale senders. This feature is
  that every such runner sends through one shared helper that answers the
  challenge the way a live sender does, that the helper's contract holds -
  queued or refused, only the identical second call's result comes back - and
  that the population of such runners is pinned so absence cannot pass.

  Amended 2026-09-14 (specifier): the former scenario 01, "each runner is green
  on main", shelled all five real runners per mutant - bl982 alone draws 100
  packs at about 2.4 s each - so no mutant could finish inside the BL-1358
  per-mutant ceiling (300 s, human ruling 2026-09-03). It is retired, never
  reworded. A minutes-long standing runner is proven green where it belongs:
  by running it, in QA's e2e procedure, and by the standing-red register, whose
  five rows leave in the land that turns them green.

  Background:
    Given the shared test helper "swarmforge/scripts/test/lib/send_through_audit.bb"

  # BL-1541 five-bb-property-runners-answer-the-self-audit-challenge-before-asserting-the-queue-02
  Scenario Outline: the population of git_handoff-drafting bb runners is pinned, so a missing runner cannot pass by absence
    When the bb runners under "swarmforge/scripts/test" that draft a git_handoff and invoke swarm_handoff.bb are derived
    Then the derived set contains "<runner>"

    Examples:
      | runner                                                                |
      | swarmforge/scripts/test/bl983_stage_queue_property_runner.bb          |
      | swarmforge/scripts/test/bl982_multi_seat_identity_property_runner.bb  |
      | swarmforge/scripts/test/bl992_declaration_ref_lookup_property_runner.bb |
      | swarmforge/scripts/test/bl991_binding_stages_property_runner.bb       |
      | swarmforge/scripts/test/bl951_stage_skip_recording_property_runner.bb |

  # BL-1541 five-bb-property-runners-answer-the-self-audit-challenge-before-asserting-the-queue-03
  Scenario Outline: the helper returns only the identical second call's result, queued or refused
    Given a send thunk whose first call answers "AUDIT_REQUIRED" and queues nothing
    And the identical second call reports "<second>"
    When a runner sends through the helper
    Then the helper returns "<second>"
    And the thunk was called exactly twice
    And the queue holds <queued> parcels

    Examples:
      | second             | queued |
      | queued one parcel  | 1      |
      | HANDOFF_NOT_QUEUED | 0      |
