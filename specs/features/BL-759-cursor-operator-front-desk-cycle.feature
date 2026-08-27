Feature: The Cursor-operator modules no longer cycle back into the front-desk bot

  The front-desk bot lazily loads the Cursor-operator modules, and those
  modules import drain helpers straight back out of it. That is a real
  import cycle, and the architect's own hard dependency-rule gate reports
  it on every parcel that touches any of the three files. Breaking the
  cycle must not change what those drain helpers decide.

  Background:
    Given this repository's own sources and its pinned dependency-rule ruleset

  # BL-759 cursor-operator-front-desk-cycle-01
  Scenario: a whole-repository dependency-rule scan reports no forbidden edge
    When the dependency-rule gate is run over the whole repository
    Then the gate passes with no forbidden edge reported

  # BL-759 cursor-operator-front-desk-cycle-02
  Scenario Outline: a Cursor-operator module no longer depends on the front-desk bot module
    When the resolved imports of <module> are collected, following re-exports
    Then the front-desk bot module is not among them

    Examples:
      | module                            |
      | telegramCursorOperatorExec.ts     |
      | telegramCursorOperatorLiveness.ts |

  # BL-759 cursor-operator-front-desk-cycle-03
  Scenario Outline: pipeline emptiness is still decided from every live role's inbox
    Given a swarm whose live roles hold <parcels>
    When a drain-stop checks whether any parcel is still in flight
    Then pipeline emptiness reports <verdict>

    Examples:
      | parcels                           | verdict   |
      | no parcel anywhere                | empty     |
      | a parcel in one role's inbox/new  | not empty |
      | a parcel in one role's in_process | not empty |

  # BL-759 cursor-operator-front-desk-cycle-04
  Scenario Outline: the bounded-drain timeout still resolves the same way
    Given the drain-timeout environment variable is <env value>
    When a drain-stop works out how long it may keep waiting
    Then the resolved drain timeout is <timeout>

    Examples:
      | env value    | timeout               |
      | unset        | the 10-minute default |
      | 5000         | 5000 ms               |
      | not-a-number | the 10-minute default |
      | 0            | the 10-minute default |
