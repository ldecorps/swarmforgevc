Feature: One redeploy verb family covers every Telegram runtime
  A change to Telegram-related extension code becomes live through a single
  documented verb family, and the reply names what actually restarted — so a
  front-desk fix can never report success while stale code keeps running.
  Source: human via Cursor 2026-07-30; BL-710.

  Background:
    Given the cursor bridge is running and I am the principal operator
    And I am in the Cursor Remote topic

  # BL-710 redeploy-clarity-01
  Scenario Outline: each redeploy form restarts its own runtime and says so
    When I send the <form> redeploy form and confirm it
    Then <restarted> is restarted
    And the reply names <restarted>
    And <untouched> is left running

    Examples:
      | form       | restarted                | untouched                |
      | bare       | the cursor bridge        | the front desk           |
      | mini app   | the mini app bridge      | the cursor bridge        |
      | front desk | the front desk           | the cursor bridge        |

  # BL-710 redeploy-clarity-02
  Scenario: the union form restarts every Telegram runtime and names them
    When I send the union redeploy form and confirm it
    Then the cursor bridge and the front desk are both restarted
    And the reply names every process that came back

  # BL-710 redeploy-clarity-03
  Scenario: a redeploy waits for confirmation
    When I send the front desk redeploy form
    Then nothing is restarted yet
    And I am asked to confirm

  # BL-710 redeploy-clarity-04
  Scenario Outline: a redeploy from the wrong place does nothing
    When <sender> sends the front desk redeploy form from <origin>
    Then no process is restarted
    And no confirmation is offered

    Examples:
      | sender          | origin              |
      | a non-principal | the Cursor Remote topic |
      | the principal   | another topic       |

  # BL-710 redeploy-clarity-05
  Scenario: a front-desk redeploy leaves new front-desk code live
    Given the front-desk sources have changed since it was last started
    When I send the front desk redeploy form and confirm it
    Then the running front desk reports a newer build than before
    And the change is compiled before the restart

  # BL-710 redeploy-clarity-06
  Scenario: help lists every redeploy form
    When I ask for help
    Then the help text lists the bare, mini app, front desk and union redeploy forms
