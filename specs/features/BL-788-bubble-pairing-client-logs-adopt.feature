Feature: Bubble pairing and client-log hotfix, adopted under review

  The 2026-08-02 Mac-host hotfix shipped a pairing and client-log path by hand.
  These scenarios pin the parts that run in this repository's Node acceptance
  runner: the bridge's pre-auth pairing page, its pre-auth APK route, and the
  pairing URL the tunnel notifier publishes. Android device behaviour is
  deliberately absent — it is environmentally unsuitable here (BL-761/BL-769).

  Background:
    Given a bridge server is running with a pairing token configured
    And the operator public directory contains "swarmforge-float-companion-0.3.12-pairing-persist.apk"

  # BL-788 bubble-pairing-client-logs-adopt-01
  Scenario: The pairing page offers an intent link carrying the installed package id
    When an unauthenticated client requests the pairing page with a valid token
    Then the response succeeds
    And the page contains an "intent://" pairing link
    And that link names the package id the shipped build installs under
    And the page does not auto-navigate to a bare custom-scheme URL

  # BL-788 bubble-pairing-client-logs-adopt-02
  Scenario: The pairing page offers copy fallbacks when the intent link is ignored
    When an unauthenticated client requests the pairing page with a valid token
    Then the page offers a copyable bridge URL
    And the page offers a copyable pairing token

  # BL-788 bubble-pairing-client-logs-adopt-03
  Scenario Outline: The pre-auth APK route serves only the operator public directory
    When an unauthenticated client requests the APK path "<requested>"
    Then the bridge responds with status <status>
    And no file outside the operator public directory is read

    Examples:
      | requested                                                   | status |
      | /swarmforge-float-companion-0.3.12-pairing-persist.apk      | 200    |
      | /swarmforge-float-companion-missing.apk                     | 404    |
      | /swarmforge-float-companion/../../../../etc/passwd.apk      | 404    |
      | /swarmforge-float-companion%2f..%2f..%2fsecrets.apk         | 404    |

  # BL-788 bubble-pairing-client-logs-adopt-04
  Scenario: A served APK is delivered as an installable package download
    When an unauthenticated client requests the APK path "/swarmforge-float-companion-0.3.12-pairing-persist.apk"
    Then the response succeeds
    And the content type is the Android package archive type
    And the response is not cached

  # BL-788 bubble-pairing-client-logs-adopt-05
  Scenario: The tunnel notification publishes an HTTPS pairing URL
    Given the resident-spy tunnel is serving a base URL over HTTPS
    When the tunnel notification is composed
    Then the notification carries a pairing URL on that HTTPS base
    And the pairing URL carries the pairing token
