# BL-1062's defect, third instance. bl1048DeliveredParcelIsNotNotStarted
# declares NINE reach floors and then hopes an UNSEEDED fast-check draw
# happened to clear them. It usually does. Sometimes it does not, and the red
# says nothing about the code under test.
#
# Measured 2026-08-29 by replaying the real generator and the test's own
# coverage-counting block over 4000 simulated runs at numRuns 24:
#
#   run-level failure on correct code            2.50%
#   deliveredOnly  >= 8   mean 15.3  min  3      1.15%
#   openedOnly     >= 8   mean 15.3  min  2      1.32%
#   noParcel       >= 4   mean 15.3  min  3      0.05%
#   bothStatesSameRole, crossRole, deliveredNote,
#   deliveredBatched, deliveredMasterResident,
#   closedButDelivered                            0.00%
#
# So it is NOT "nine fragile floors". Seven of the nine clear by a wide margin
# and need no change; TWO carry the entire risk, both at floor 8 on a shape
# drawn with p=1/6 per ticket. A fix that rewrites all nine would be churn
# over six floors that were never at risk.
#
# 2.5% is the same magnitude as bl948 (~2.3%), which BL-1062 already covers -
# not bl968's ~16%. It is a sibling rather than an amendment because BL-1062 is
# already at the documenter with its fix built, and widening it there would
# force a rebuild of a nearly-complete parcel.
#
# The remedy is BL-1062's, reused, not reinvented: make the demanded coverage
# reachable BY CONSTRUCTION, floors intact, through the shared helper it landed
# at extension/test/helpers/reachFloors.js. The floors are load-bearing - a
# generator that silently stopped producing a value must still go red - so
# lowering or deleting them is not a fix.

Feature: bl1048's reach floors are satisfiable by construction, not by a lucky seed

  Background:
    Given the bl1048 delivered-parcel property test and its nine declared reach floors

  # BL-1281 bl1048-reach-floors-satisfiable-by-construction-01
  Scenario Outline: the two at-risk floors are met whatever the seed
    Given the property runs with seed <seed>
    When the run completes
    Then the delivered-only and opened-only reach floors are both met

    Examples:
      | seed |
      | 1    |
      | 7    |
      | 4242 |

  # BL-1281 bl1048-reach-floors-satisfiable-by-construction-02
  Scenario: no floor is lowered or removed to make the run pass
    When the declared reach floors are read
    Then all nine are still declared, none below the value it had before this change

  # BL-1281 bl1048-reach-floors-satisfiable-by-construction-03
  Scenario: the floor assertion still fails when a value is genuinely unreached
    Given a coverage map in which the delivered-only value was drawn fewer times than its floor
    When the shared reach-floor assertion runs against it
    Then it fails and names that value
