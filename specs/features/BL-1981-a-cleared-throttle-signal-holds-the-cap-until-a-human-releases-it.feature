Feature: BL-1981 A cleared throttle signal holds the cap until a human releases it

  Article 3.5 throttles intake when a health signal spikes, and BL-432 and
  BL-1429 automated it: effective_backlog_depth_cli.bb folds the throttle
  recommendation in as min(configured, recommended), so the cap climbed
  back the moment the signal cleared. Human, 2026-10-05, to the
  coordinator: "Change logic around circuit breaker cap 1. Once cap 1 is
  reached, ask if it is safe to release the cap. The idea is that we
  prevent issues from piling up. The swarm is working ok, it is not safe to
  resume churning at full throttle [just because signals look normal
  again]."

  This feature is the hold. A throttle episode opens on the first run
  whose recommendation lowers the cap. After the signal clears, the
  effective cap stays at the lowest cap the episode reached until a human
  answer is recorded with the release CLI: a release restores the
  configured cap, a keep holds the value the human gave. A release
  recorded while the signal is still elevated is a pre-approval for that
  episode only. The raw recommendation is still withdrawn when its signal
  clears, as BL-1429 scenario 03 asserts; only the effective cap is held.
  Raising the question to the human is BL-1982. Every scenario runs
  against a fixture root under a temporary directory, never the live
  checkout.

  Background:
    Given a fixture root with a standing-red register and a swarmforge.conf configuring an active_backlog_max_depth of 6

  # BL-1981 a-cleared-signal-holds-the-cap-01
  Scenario: a cleared signal holds the throttled cap and reports the episode awaiting release
    Given the register crossed the count threshold and the depth CLI printed 1
    And the register has fallen back under every threshold
    When the depth CLI runs on the fixture root
    Then the depth CLI prints 1
    And the throttle recommendation reports the episode awaiting release, naming the red count and the configured cap of 6
    And the throttle change log records the cap held at 1 for a human release

  # BL-1981 a-release-restores-the-configured-cap-02
  Scenario: a release recorded after the signal clears restores the configured cap
    Given the register crossed the count threshold and the depth CLI printed 1
    And the register has fallen back under every threshold and the depth CLI printed 1
    When the release CLI records a release by "human"
    And the depth CLI runs on the fixture root
    Then the depth CLI prints 6
    And the throttle recommendation reports no episode awaiting release
    And the throttle change log records the release by "human"

  # BL-1981 a-release-before-the-signal-clears-is-a-pre-approval-03
  Scenario: a release recorded while the signal is elevated restores the cap when it clears, with no wait
    Given the register crossed the count threshold and the depth CLI printed 1
    And the release CLI recorded a release by "human" while the register was over the count threshold
    And the register has fallen back under every threshold
    When the depth CLI runs on the fixture root
    Then the depth CLI prints 6
    And the throttle recommendation reports no episode awaiting release

  # BL-1981 a-keep-holds-the-value-the-human-gave-04
  Scenario: a keep answer holds the cap at the value the human gave and is not awaiting release
    Given the register crossed the count threshold and the depth CLI printed 1
    And the register has fallen back under every threshold and the depth CLI printed 1
    When the release CLI records a keep at 3 by "human"
    And the depth CLI runs on the fixture root
    Then the depth CLI prints 3
    And the throttle recommendation reports no episode awaiting release

  # BL-1981 an-answer-never-lifts-a-live-signal-05
  Scenario Outline: a recorded answer never lifts the cap above a live signal's recommendation
    Given the register crossed the count threshold and the depth CLI printed 1
    When the release CLI records <answer> by "human"
    And the depth CLI runs on the fixture root
    Then the depth CLI prints 1

    Examples:
      | answer      |
      | a release   |
      | a keep at 3 |

  # BL-1981 a-later-episode-holds-again-06
  Scenario: an answer recorded for one episode does not carry to the next
    Given the register crossed the count threshold and the depth CLI printed 1
    And the release CLI recorded a release by "human" while the register was over the count threshold
    And the register has fallen back under every threshold and the depth CLI printed 6
    And the register crossed the count threshold and the depth CLI printed 1
    And the register has fallen back under every threshold
    When the depth CLI runs on the fixture root
    Then the depth CLI prints 1
    And the throttle recommendation reports the episode awaiting release, naming the red count and the configured cap of 6
