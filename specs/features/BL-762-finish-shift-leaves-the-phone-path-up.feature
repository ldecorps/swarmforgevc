Feature: bedtime stops the pack but leaves the phone path reachable

  # BL-762: on 2026-07-30 the day-shift-end path ran the full stop-swarm.sh,
  # which stops ancillaries (babysitterd, operator runtime, Telegram front desk,
  # onboarder, remote tunnels) and then the pipeline. The front desk owns the
  # Let's Talk bridge and the tunnels publish it, so the phone lost its origin:
  # Bubble showed Cloudflare 530 / Error 1033 and read as "app dead" when only
  # the host path had been torn down. Bedtime and lights-out are two different
  # intentions and the stack only implements one of them. This adds the bedtime
  # verb; stop-swarm.sh stays the lights-out verb, unchanged.

  Background:
    Given a running swarm with its ancillary services up

  # BL-762 keep-kill-matrix-01
  Scenario Outline: each lifecycle verb stops exactly the components it owns
    When the operator runs <verb>
    Then <component> is <disposition>

    Examples:
      | verb         | component               | disposition |
      | finish-shift | the swarm agent sessions | stopped     |
      | finish-shift | handoffd                 | stopped     |
      | finish-shift | babysitterd              | stopped     |
      | finish-shift | the operator runtime     | stopped     |
      | finish-shift | the onboarder            | stopped     |
      | finish-shift | the Telegram front desk  | left running |
      | finish-shift | the remote tunnels       | left running |
      | stop-swarm   | the Telegram front desk  | stopped     |
      | stop-swarm   | the remote tunnels       | stopped     |

  # BL-762 phone-path-survives-02
  Scenario: after bedtime the phone still reaches the host bridge
    When the operator runs finish-shift
    Then the bridge is still listening on its configured port
    And the published tunnel still resolves to that bridge

  # BL-762 no-relaunch-after-bedtime-03
  Scenario: nothing left running after bedtime can revive a stopped seat
    When the operator runs finish-shift
    Then no surviving component is one that relaunches agent seats

  # BL-762 lights-out-still-works-04
  Scenario: the full stop after bedtime still tears the phone path down
    Given the operator has already run finish-shift
    When the operator runs stop-swarm
    Then the Telegram front desk is stopped
    And the remote tunnels are stopped
    And the survivor scan reports a clean slate

  # BL-762 idempotent-05
  Scenario Outline: bedtime is safe to run when its targets are already down
    Given <starting state>
    When the operator runs finish-shift
    Then the command succeeds
    And the components bedtime leaves up are unchanged

    Examples:
      | starting state                          |
      | the swarm is already stopped            |
      | bedtime has already been run once       |

  # BL-762 scheduled-end-of-day-picks-its-verb-06
  Scenario Outline: the scheduled end of day picks its verb from configuration
    Given the scheduled day-shift-end is configured <configuration>
    When the scheduled end of day runs
    Then <expected> is the verb invoked

    Examples:
      | configuration               | expected           |
      | with no lights-out override | the bedtime verb   |
      | for lights-out              | the full stop verb |
