# mutation-stamp: sha256=bb97c3d0720dad61b35f36bff2540addbf51724758cb0318d2f5d0ced2068d5a
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-01T04:21:41.374495215Z","feature_name":"BL-1316 a seat's reasoning effort follows the claimed ticket's mutation_cost","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1316-claim-time-effort-follows-ticket-difficulty.feature","background_hash":"6bd3903a05a00194695b399ef1f107d1b5ddadab162bbf24c488ba2742ea2307","implementation_hash":"unknown","scenarios":[{"index":0,"name":"claiming a ticket sets effort from its mutation_cost","scenario_hash":"86c2da00abd5da37346a405b744affce58cfa28e60c49b065f925367f89453d1","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-09-01T04:21:41.374495215Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1316 a seat's reasoning effort follows the claimed ticket's mutation_cost

  BL-1001 chooses WHICH seat may claim by `mutation_cost`. BL-236's Suggest
  tier sets a static per-ROLE effort. Neither changes how hard a seat thinks
  for THIS ticket. Hard tickets on a Composer/Haiku seat still run at the pack's
  default effort; easy tickets burn the same budget. This ticket closes that
  gap: when a seat claims (or reclaims) work, its reasoning effort is set from
  the ticket's `mutation_cost` — crank for high, shrink for low — on every
  backend that exposes an effort / thinking lever. Backends with no lever skip
  the apply and stay on their pack model (never invent a fake flag).

  Background:
    Given a running seat whose backend exposes a reasoning-effort setting
    And pack windows may pin a default model without a per-ticket effort

  # BL-1316 maps-mutation-cost-to-effort-01
  Scenario Outline: claiming a ticket sets effort from its mutation_cost
    Given a ticket whose mutation_cost is <mutation_cost>
    When the seat claims it
    Then the seat's reasoning effort becomes <effort>
    Examples:
      | mutation_cost | effort |
      | low           | low    |
      | medium        | medium |
      | high          | high   |

  # BL-1316 absent-cost-keeps-pack-default-02
  Scenario: a ticket without mutation_cost leaves the pack default effort in place
    Given a ticket with no mutation_cost field
    When the seat claims it
    Then the seat's reasoning effort is unchanged from the pack/window default

  # BL-1316 backend-without-effort-skips-03
  Scenario: a backend with no effort lever never receives an unsupported flag
    Given a seat on a backend that exposes no reasoning-effort setting
    And a ticket whose mutation_cost is high
    When the seat claims it
    Then no unsupported effort argument is sent to that backend
    And the claim still succeeds

  # BL-1316 next-claim-retunes-04
  Scenario: the next claim retunes effort; a prior ticket's effort does not stick
    Given the seat previously claimed a high mutation_cost ticket at high effort
    When the seat claims a low mutation_cost ticket
    Then the seat's reasoning effort becomes low
