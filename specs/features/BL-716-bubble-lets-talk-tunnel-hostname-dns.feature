Feature: Bubble Let's Talk fails clearly when the tunnel hostname will not resolve
  A configured bridge host that cannot be resolved or reached must not leave
  the phone looking healthy while recording. After a live URL is restored, a
  turn works again without reinstall.
  Source: human via Let's Talk / Cursor 2026-07-30; BL-716.

  Background:
    Given the Bubble companion is paired to a bridge base URL
    And Let's Talk hands-free mode is available

  # BL-716 dns-01
  Scenario: unresolvable bridge host leaves recording
    Given the configured bridge host cannot be resolved
    When the human starts or continues a Let's Talk turn
    Then the app shows a clear host or connection error
    And it does not remain in a healthy recording state

  # BL-716 dns-02
  Scenario: unreachable bridge host is treated the same class of failure
    Given the configured bridge host resolves but the turn endpoint is unreachable
    When the human starts a Let's Talk turn
    Then the app shows a clear connection error
    And recording does not stay fake-healthy

  # BL-716 dns-03
  Scenario: refreshed live URL restores turns
    Given the phone previously failed on a stale or dead tunnel hostname
    When the operator supplies a live bridge base URL
    And the human sends a Let's Talk turn
    Then the turn reaches the bridge successfully
    And the app does not require reinstall

  # BL-716 dns-04
  Scenario: operator can learn the new hostname when the tunnel changes
    Given the host quick tunnel hostname has changed
    When the operator follows the documented or in-product refresh path
    Then the phone can be updated to the new URL without hunting logs blind
