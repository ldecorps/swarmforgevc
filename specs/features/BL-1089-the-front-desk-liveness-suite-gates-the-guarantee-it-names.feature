# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T06:53:47.706940503Z","feature_name":"The front-desk liveness suite gates the guarantee it names","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1089-the-front-desk-liveness-suite-gates-the-guarantee-it-names.feature","background_hash":"cd4172d969f8b41b611e887e3d8f20f0fc97fec472a3b7b555c4a65baf5fe28d","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: The front-desk liveness suite gates the guarantee it names

  BL-370 exists because a front-desk bot once held a live pid for about nine
  hours while it had stopped listening. Its liveness suite is the regression
  cover for that outage: stopped-listening is detected, the bot is restarted
  up to a cap, and past the cap a human is told.

  BL-1035 then taught the supervisor to ignore a heartbeat written before the
  child it is judging spawned, because such a heartbeat belongs to the dead
  instance the child replaced. That change is correct and stays. But the
  liveness fixture simulates "stopped listening" by writing a heartbeat older
  than the running child's own spawn time - which under the new and correct
  reading is not a bot that stopped listening at all, it is a fresh child that
  has not spoken yet, and the startup grace rightly waives it.

  So the suite went red and stayed red, and every check downstream of the
  first stall went dark with it. The supervisor is behaving correctly; the
  cover for that behaviour is what is missing.

  Background:
    Given a front-desk supervisor watching a bot that holds a live process

  # BL-1089 the-front-desk-liveness-suite-gates-the-guarantee-it-names-01
  Scenario: a bot that served and then stopped listening is declared stalled
    Given the bot has completed a poll since it started
    And nothing further has been polled for longer than the stall window
    When the supervisor checks the bot
    Then the bot is declared stalled
    And the stall is recorded with the window it exceeded

  # BL-1089 the-front-desk-liveness-suite-gates-the-guarantee-it-names-02
  Scenario: a bot still inside its startup grace is not declared stalled
    Given the bot has not completed a poll since it started
    And it is still inside its startup grace
    When the supervisor checks the bot
    Then the bot is not declared stalled

  # BL-1089 the-front-desk-liveness-suite-gates-the-guarantee-it-names-03
  Scenario: a poll completed before this bot started does not count as this bot serving
    Given the only recorded poll was completed before the bot started
    And it is still inside its startup grace
    When the supervisor checks the bot
    Then the bot is not declared stalled

  # BL-1089 the-front-desk-liveness-suite-gates-the-guarantee-it-names-04
  Scenario: the stall guard is still armed once the startup grace has passed
    Given the bot has not completed a poll since it started
    And its startup grace has passed
    When the supervisor checks the bot
    Then the bot is declared stalled

  # BL-1089 the-front-desk-liveness-suite-gates-the-guarantee-it-names-05
  Scenario: a bot that keeps stalling is restarted to its cap and then escalated
    Given a bot that stops listening again after every restart
    When the supervisor checks it repeatedly
    Then it is restarted no more times than its configured attempt cap allows
    And once the cap is spent the failure is escalated to the human
