Feature: Ensure recognises every single-resident rotation value as dormant-capable

  The launcher and ensure disagree about what `config rotation sequential`
  means. `swarmforge.sh`'s is_sequential_dormant treats "sequential" and
  "router" alike — on both, only the resident and the coordinator get a real
  session and the five middle pipeline roles are left dormant (worktree +
  roles.tsv + a pre-generated launch script). But ensure's predicate matches
  the literal "router" only, so on a `mono-rotate` pack it reads those
  deliberately-dormant roles as broken panes and respawns them.

  The cost lands exactly where it hurts most: `mono-rotate` is the pack chosen
  for memory-constrained hosts, and a single `./swarm ensure` starts five extra
  agent processes on a box that has already OOM-crashed under a full swarm.

  The widening must stop at ensure. The same router-only predicate also drives
  the ROTATE_HOME backstop in ready_for_next, where changing it would be a
  behavior change needing its own spec — so that path is pinned here, not
  altered.

  Background:
    Given the resident and the coordinator hold standing sessions
    And the five middle pipeline roles have no standing session

  # BL-571 sequential-dormant-parity-01
  Scenario Outline: ensure leaves middle roles dormant on either single-resident rotation value
    Given a pack declaring rotation "<rotation>"
    When swarm ensure runs
    Then the five middle pipeline roles are reported DORMANT
    And ensure respawns no middle pipeline role

    Examples:
      | rotation   |
      | router     |
      | sequential |

  # BL-571 sequential-dormant-parity-02
  Scenario: a classic pack still repairs its missing middle-role sessions
    Given a pack declaring no rotation mode
    When swarm ensure runs
    Then no middle pipeline role is reported DORMANT
    And ensure repairs every missing middle pipeline role

  # BL-571 sequential-dormant-parity-03
  Scenario: the rotate-home backstop keeps its router-only meaning
    Given a pack declaring rotation "sequential"
    And a non-home role whose mailbox is empty
    When that role runs ready_for_next
    Then the rotate-home backstop does not fire
