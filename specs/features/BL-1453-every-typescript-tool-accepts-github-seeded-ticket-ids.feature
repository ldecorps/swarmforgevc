Feature: BL-1453 Every TypeScript tool that validates a ticket id accepts GitHub-seeded ids through the one shared predicate

  BL-1452 gives the TypeScript side one exported ticket-id predicate
  accepting BL-<n> and GH-<n> and moves the bounce recorders and the
  sibling checker onto it. Thirteen more sites still carry a private
  ^BL-\d+ pattern: the Telegram ambulance and expedite commands, the cursor
  operator exec, the legacy topic reconcile, the catch-up feed, the
  telegram control core, the bridge ticket update, the feature-handler
  registration text, deprecate-check's id parsing and the delivery
  metrics' path classifiers. Each one silently excludes a GH ticket from a
  feature the swarm offers every other ticket: it cannot be ambulanced or
  expedited from Telegram, its topic is not reconciled, its delivery is
  not counted. This feature is that every such site uses the shared
  predicate and none keeps a private one.

  # BL-1453 a-gh-ticket-is-accepted-wherever-a-bl-ticket-is-01
  Scenario Outline: a GitHub-seeded id is accepted by every tool that accepts a swarm-numbered id
    Given the tool <tool>
    When it is given the ticket id GH-24 where it accepts BL-24
    Then it accepts GH-24 exactly as it accepts BL-24

    Examples:
      | tool                                  |
      | the Telegram ambulance command        |
      | the Telegram expedite command         |
      | the cursor operator exec ticket check |
      | the legacy topic reconcile key        |
      | the catch-up feed topic id            |
      | the bridge ticket update id           |
      | the feature-handler registration text |
      | deprecate-check's id parsing          |
      | the delivery metrics path classifier  |

  # BL-1453 no-private-ticket-pattern-remains-02
  Scenario: no TypeScript source outside the shared module carries a private ticket-id pattern
    When every file under extension/src is scanned for a ticket-id regular expression anchored on BL alone
    Then none is found outside the shared predicate module
