# mutation-stamp: sha256=f201aeb4413f97974ab491e189ba381b2cb4511814f3a7ece2a658e84411de31
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T14:05:51.869659330Z","feature_name":"A stage's seats are chosen by ticket difficulty, not by whichever is idle","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1001-difficulty-aware-coder-seat-routing.feature","background_hash":"a581c3000aa716488c946fb9733f7f45631875d5a1218f841b6f802d2b5598e1","implementation_hash":"unknown","scenarios":[{"index":0,"name":"The ticket's difficulty selects the seat when both are idle","scenario_hash":"30b728c31041b884b8089c0a96403c92b8befb5bd0a4dd55e6f987a55c972458","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-24T14:05:51.869659330Z"}]}
# acceptance-mutation-manifest-end

Feature: A stage's seats are chosen by ticket difficulty, not by whichever is idle

  BL-983 delivers a stage-addressed parcel to whichever seat of that stage is
  idle, deliberately blind to difficulty. The two coder seats are not
  equivalent, so blind delivery lands hard work on the seat that bounces it -
  paying for a second seat and getting rework, which is the false economy the
  operator named.

  Difficulty comes from the ticket's existing `mutation_cost`. Each seat
  declares the hardest tier it may be given; nothing is inferred from a seat's
  name or the order the seats were introduced.

  The rule is deliberately asymmetric. A ticket above a seat's declared tier
  never lands on it, however idle it is - it waits for a seat that may take
  it. An easy ticket may go to a harder-tier seat when its own is busy,
  because that direction costs money rather than correctness.

  Background:
    Given a stage with two seats, one declared for hard work and one declared easy-only

  # BL-1001 difficulty-picks-the-seat-01
  Scenario Outline: The ticket's difficulty selects the seat when both are idle
    Given a ticket whose mutation_cost is <mutation_cost>
    When the stage claims it
    Then the <seat> seat holds it
    Examples:
      | mutation_cost | seat      |
      | low           | easy-only |
      | medium        | hard      |
      | high          | hard      |

  # BL-1001 hard-work-waits-rather-than-spilling-down-02
  Scenario: A ticket above the easy seat's tier waits rather than spilling onto it
    Given a ticket whose mutation_cost is high
    And the hard seat is busy
    And the easy-only seat is idle
    When the stage claims it
    Then no seat holds it
    And the hard seat holds it once it frees

  # BL-1001 easy-work-spills-up-03
  Scenario: An easy ticket spills up to the hard seat when its own seat is busy
    Given a ticket whose mutation_cost is low
    And the easy-only seat is busy
    And the hard seat is idle
    When the stage claims it
    Then the hard seat holds it

  # BL-1001 tier-is-declared-not-inferred-04
  Scenario: Exchanging the seats' declared tiers moves the routing with them
    Given the two seats' declared tiers are exchanged
    And a ticket whose mutation_cost is high
    When the stage claims it
    Then the hard seat holds it
