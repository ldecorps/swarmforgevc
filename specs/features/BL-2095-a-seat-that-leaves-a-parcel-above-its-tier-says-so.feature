Feature: BL-2095 A seat that leaves a parcel above its tier says so

  A stage with two seats hands a queued parcel to whichever seat asks
  first (BL-983), except that a seat never takes a ticket above its tier
  (BL-1001) and leaves a rework to the seat that worked it (BL-1004). The
  claim path drops both kinds from the candidates and claims the first
  parcel left. A deferral prints a DEFERRED line; a tier skip prints
  nothing. On 2026-10-09 the full-forge coder stage had an easy-only local
  seat, coder, and a hard seat, coder@2. Four Work notes for medium
  tickets waited in the stage queue while coder@2 rebuilt BL-2077, and
  coder answered a bare NO_TASK on every poll, as BL-1001 means it to. The
  coordinator read the queue as wedged behind the one deferred note,
  moved that note by hand and reported a dispatcher defect. coder's next
  poll was NO_TASK again. A seat now names each parcel it leaves above
  its tier, so a NO_TASK beside a full queue explains itself.

  Background:
    Given the coder stage has two seats, coder declared easy-only and coder@2 declared for hard work

  # BL-2095 a-tier-skip-is-said-out-loud-01
  Scenario: an easy seat that leaves a medium parcel names it and still reports no task
    Given ticket BL-9001's mutation_cost is medium
    And the stage queue holds the note "Work BL-9001: merge main first, then read backlog/active"
    When seat coder asks for its next task
    Then its output has a line naming that note's file, BL-9001 and medium as above this seat's tier
    And that line names no other seat of the stage
    And its output ends with NO_TASK
    And the note about BL-9001 stays in the stage queue

  # BL-2095 a-left-parcel-never-holds-up-the-one-behind-it-02
  Scenario Outline: a parcel the seat leaves at the head of the queue never keeps it from the parcel behind
    Given ticket BL-9001's mutation_cost is <cost>
    And BL-9001 has been worked by <worked by>
    And ticket BL-9003's mutation_cost is low
    And the stage queue holds the note "Work BL-9001: merge main first, then read backlog/active"
    And the stage queue holds the note "Work BL-9003: merge main first, then read backlog/active"
    And the note about BL-9001 is at the head of the stage queue
    When seat coder asks for its next task
    Then seat coder claims the note about BL-9003
    And the note about BL-9001 stays in the stage queue

    Examples:
      | cost   | worked by    |
      | medium | no seat      |
      | low    | seat coder@2 |
