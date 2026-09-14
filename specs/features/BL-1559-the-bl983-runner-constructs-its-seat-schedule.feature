Feature: BL-1559 The bl983 runner constructs its seat schedule

  bl983_stage_queue_property_runner.bb asserts absolute reach floors
  (two-seat >= 6, three-seat >= 3, all-busy >= 4, redeliver >= 4,
  forward >= 4) over 16 draws whose seat count is a fair coin and whose
  parcel count is a uniform draw, so about one run in ten fails on
  generator coverage while every BL-983 invariant held (architect, 2 of 4
  runs at two-seat 5, 2026-09-14). This feature is that the runner's draw
  plan comes from a test lib, draw_schedule.bb, whose schedule meets every
  quota by construction for any run count of at least nine, in an order
  that stays shuffled, and that the runner still asserts each floor at its
  value. The runner's own green is QA's e2e procedure, never a scenario
  here: shelling it per mutant cannot fit the BL-1358 ceiling (the BL-1541
  amendment of 2026-09-14 retired that shape).

  # BL-1559 constructs-its-seat-schedule-01
  Scenario Outline: the seat schedule reaches each floor by construction under every seed
    When the seat schedule for <runs> draws is built under 20 distinct seeds
    Then each of those schedules is <runs> plans long
    And every one of those schedules counts at least <floor> <cell> plans

    Examples:
      | runs | cell       | floor |
      | 16   | two-seat   | 6     |
      | 16   | three-seat | 3     |
      | 16   | all-busy   | 4     |
      | 32   | two-seat   | 6     |
      | 9    | two-seat   | 6     |
      | 9    | three-seat | 3     |
      | 9    | all-busy   | 4     |

  # BL-1559 constructs-its-seat-schedule-02
  Scenario Outline: the seat schedule keeps its draw order random across seeds
    When the seat schedule for <runs> draws is built under 20 distinct seeds
    Then at least two of those schedules differ in the order of their plans
    And every plan in every schedule names 2 or 3 seats and 1 to seats-plus-one parcels

    Examples:
      | runs |
      | 16   |
      | 9    |

  # BL-1559 constructs-its-seat-schedule-03
  Scenario Outline: the runner consumes the schedule and still asserts each floor
    When the source of the bl983 runner is read
    Then it loads the draw schedule test lib
    And it still asserts the reach floor <floor>

    Examples:
      | floor          |
      | :two-seat 6    |
      | :three-seat 3  |
      | :all-busy 4    |
      | :redeliver 4   |
      | :forward 4     |
