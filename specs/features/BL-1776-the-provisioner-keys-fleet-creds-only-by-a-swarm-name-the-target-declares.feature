Feature: BL-1776 The provisioner keys fleet creds only by a swarm name the target declares

  provision-onboarding-telegram-channel.js writes the new swarm's bot
  token, chat and bridge port to ~/.swarmforge/fleet/<swarm-name>/telegram.json
  under whatever <swarm-name> it is given. The front desk later looks them
  up under the target's own config swarm_name. gpu-bargain-hunter was
  provisioned as "gpu-bargain-hunter" before its pack declared
  "config swarm_name GpuBargainHunter", so its credentials sat where
  nothing would ever look (2026-09-26). Hotfix e5a03ee6c7 only told the
  operator, in the tutorial, to pass the same name.

  Here the provisioner checks the name before it does anything else: it
  proceeds only for a name that the target's swarmforge.conf or one of its
  pack confs declares, and otherwise refuses, naming what the target does
  declare, with nothing written and no call to Telegram. Every scenario
  runs against a fixture target, a fixture home and a fake Bot API.

  Background:
    Given a fixture target and a fixture home under a temporary root

  # BL-1776 a-declared-name-is-accepted-01
  Scenario Outline: a swarm name the target declares passes the check
    Given the target's <conf> declares config swarm_name "GpuBargainHunter"
    When the provisioner's swarm name check runs for "GpuBargainHunter"
    Then the check accepts it

    Examples:
      | conf                              |
      | swarmforge/swarmforge.conf        |
      | swarmforge/packs/mono-router.conf |

  # BL-1776 an-undeclared-name-is-refused-before-anything-is-written-02
  Scenario Outline: a swarm name the target does not declare is refused with nothing written
    Given the target <declares>
    When the provisioner runs for the target with swarm name "gpu-bargain-hunter"
    Then it exits non-zero naming "gpu-bargain-hunter" and <named>
    And no fleet creds directory exists for "gpu-bargain-hunter" under the fixture home
    And the fake Bot API was never called

    Examples:
      | declares                                                                              | named               |
      | whose swarmforge/packs/mono-router.conf declares config swarm_name "GpuBargainHunter" | "GpuBargainHunter"  |
      | that declares no swarm_name in any conf                                               | "config swarm_name" |
