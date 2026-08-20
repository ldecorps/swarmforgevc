Feature: Epic reorder tiles show a velocity-based ETA per epic

  BL-572's reorder screen lists one tile per epic on the live Mini App
  console. Each tile gains a best-estimate ETA derived from the swarm's
  recent completion velocity, so the human reorders against "how long is
  each of these", not just names. Display-and-estimate only: the ETA
  changes no scheduling, promotes nothing, and gates no build.

  Every scenario below drives the pure estimator and the reorder state
  feed it is folded into, over fixtures with an injected clock — no git
  and no live bridge in any step. Remaining size is a
  mutation_cost-weighted roll-up over the epic's OPEN children
  (active + paused + hold); done children and the epic tracker itself
  contribute zero. A child that cannot start — held in backlog/hold/,
  status blocked or needs_design, or carrying a non-empty
  promotion_blockers or block_until — is BLOCKED: surfaced distinctly,
  never folded into a velocity-derived duration.

  Background:
    Given a fixture backlog with epics and their child tickets
    And a fixture completion history over a trailing window
    And the epic reorder state is composed from these fixtures

  # BL-591 epic-eta-01
  Scenario: a buildable epic shows a range and its pace assumption, never a point date
    Given an epic whose open children are all buildable
    And the completion history shows a steady completion rate
    When the epic's tile state is composed
    Then the tile shows an ETA as a range with a low bound and a strictly greater high bound
    And the tile names the pace assumption the range rests on
    And the pace assumption names the pack and the trailing window the velocity was measured on
    And no NaN, Infinity, or single-date ETA appears in the tile state

  # BL-591 epic-eta-02
  Scenario: an epic with no open children shows complete, not a forecast
    Given an epic all of whose children are done
    When the epic's tile state is composed
    Then the tile shows a complete state with zero remaining weight
    And no ETA range and no pace assumption is shown for it

  # BL-591 epic-eta-03
  Scenario: a blocked child is surfaced alongside the range, never folded into it
    Given an epic with two buildable children and one child carrying a non-empty block_until list
    When the epic's tile state is composed
    Then the ETA range is derived from the two buildable children's weight only
    And the tile reports one blocked child alongside the range
    And recomputing with the blocked child removed leaves the ETA range unchanged

  # BL-591 epic-eta-04
  Scenario Outline: every not-startable child state counts as blocked
    Given an epic with one buildable child and one child that is <blocked-how>
    When the epic's tile state is composed
    Then the tile reports one blocked child alongside the range
    And the ETA range equals the range computed for the buildable child alone

    Examples:
      | blocked-how                           |
      | held in backlog/hold/                 |
      | marked status needs_design            |
      | marked status blocked                 |
      | carrying a non-empty block_until list |
      | carrying non-empty promotion_blockers |

  # BL-591 epic-eta-05
  Scenario: an epic whose open children are all blocked shows a blocked state, no duration
    Given an epic whose open children all carry non-empty block_until lists
    When the epic's tile state is composed
    Then the tile shows a blocked state naming why in a word
    And no ETA range and no pace assumption is shown for it

  # BL-591 epic-eta-06
  Scenario: remaining weight is mutation_cost-weighted over open children only
    Given an epic with one open child of mutation_cost low and one open child of mutation_cost high
    When the epic's remaining weight is computed
    Then the high-cost child contributes strictly more weight than the low-cost child
    And a done child contributes zero weight
    And the epic tracker itself contributes zero weight

  # BL-591 epic-eta-07
  Scenario: zero recent completions degrades honestly, never divides to nonsense
    Given an epic whose open children are all buildable
    And a completion history with no completions in the trailing window
    When the epic's tile state is composed
    Then the tile shows a no-recent-pace state instead of a range
    And no NaN, Infinity, or single-date ETA appears in the tile state

  # BL-591 epic-eta-08
  Scenario: confidence is shown per epic and degrades as blocked weight rises
    Given an epic whose open children are all buildable
    And the completion history shows a steady completion rate
    And a second epic identical except most of its remaining weight is blocked
    When both epics' tile states are composed
    Then each tile shows a confidence level
    And the mostly-blocked epic's confidence is strictly lower than the all-buildable epic's
    And the mostly-blocked epic's tile names the reason in a word
