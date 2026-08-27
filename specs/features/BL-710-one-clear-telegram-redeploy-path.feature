# mutation-stamp: sha256=8e9a53cc8a3c3b185560dc2b754aed9b8c7d0bcbc7252179404f46c066c64fc8
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-27T11:03:21.165169547Z","feature_name":"One redeploy verb family covers every Telegram runtime","feature_path":"/tmp/bl710-hardener-1297109/specs/features/BL-710-one-clear-telegram-redeploy-path.feature","background_hash":"32f0b643f4dd6495f62ad8043ca6820f30fc8351c3f345a10a3adbaa7747ca22","implementation_hash":"unknown","scenarios":[{"index":0,"name":"each redeploy form restarts its own runtime and says so","scenario_hash":"6a4d095e10092caabd54114c596964cc0c36655fe10f47ad47928f1cd7592328","mutation_count":9,"result":{"Total":9,"Killed":9,"Survived":0,"Errors":0},"tested_at":"2026-08-27T11:03:21.165169547Z"},{"index":3,"name":"a redeploy from the wrong place does nothing","scenario_hash":"c5b2a1cbdec76f355179918ddc59b7445343b0fd52b1ea62538cdf5bb23d7c17","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-27T11:03:21.165169547Z"}]}
# acceptance-mutation-manifest-end

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
