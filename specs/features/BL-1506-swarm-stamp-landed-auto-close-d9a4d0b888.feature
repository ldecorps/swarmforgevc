Feature: BL-1506 Stamp-off review of the landed auto-close hotfix

  BL-848 review-only certification of landed commit d9a4d0b888 (2026-09-09).
  BL-1278 passed every stage on the all-GLM pack and QA landed it, but the
  coordinator completed QA's parcel without the active-to-done move and
  chased a phantom drop; the landed-but-open sweep only read commit
  subjects and only ever nudged QA. The hotfix reads QA's land record as a
  second landed signal and has the daemon run close_ticket.sh itself
  through the same guarded path the coordinator uses: one attempt per
  tick, a 30-minute per-ticket cooldown, a coordinator note on success, a
  logged refusal and the legacy QA nudge otherwise.

  These scenarios confirm or refute what landed; none may rewrite it, and
  none writes a certify or waive decision into backlog/hotfix-ledger.yaml -
  only a recorded human decision does that.

  # BL-1506 swarm-stamp-landed-auto-close-01
  Scenario Outline: only an active ticket whose latest land row is on origin/main is a candidate
    Given a ticket that is <ticket state> with a latest land-approval row whose commit is <commit state>
    When the auto-close candidates are selected
    Then the ticket is <verdict>

    Examples:
      | ticket state                          | commit state                | verdict         |
      | active                                | an ancestor of origin/main  | a candidate     |
      | active                                | not on origin/main          | not a candidate |
      | active with a Close subject on main   | an ancestor of origin/main  | not a candidate |
      | in backlog/done                       | an ancestor of origin/main  | not a candidate |

  # BL-1506 swarm-stamp-landed-auto-close-02
  Scenario: at most one close is attempted per tick
    Given two candidates both due for an attempt
    When one daemon tick runs the auto-close
    Then exactly one close is attempted
    And the other is attempted on a later tick

  # BL-1506 swarm-stamp-landed-auto-close-03
  Scenario: a refused close moves nothing and the legacy QA nudge still fires
    Given a candidate whose close the ticket-close guard refuses
    When the auto-close attempts it
    Then the refusal is logged as landed-auto-close-refused with the guard's detail
    And the ticket file is still in backlog/active
    And the legacy landed-but-open nudge to QA still fires for it

  # BL-1506 swarm-stamp-landed-auto-close-04
  Scenario: a successful close tells the coordinator and is not retried inside the cooldown
    Given a candidate whose close succeeds
    When the auto-close attempts it
    Then the coordinator receives a note of at most 80 characters naming the ticket and the landed commit
    And an attempt is recorded for the ticket
    And a second attempt inside the 30-minute cooldown is not made

  # BL-1506 swarm-stamp-landed-auto-close-05
  Scenario: the coordinator's prompt describes the mechanism it now shares with the daemon
    When swarmforge/roles/coordinator.prompt is read
    Then it names landed auto-close and hotfix d9a4d0b888 before its close step

  # BL-1506 swarm-stamp-landed-auto-close-06
  Scenario: the stamp leaves the certification decision to the human
    When the review parcel completes
    Then the ledger row for the reviewed commit still reads "pending"
