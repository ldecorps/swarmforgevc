Feature: swarmforge.sh reports failures on stderr

  Every "Error:" message in swarmforge.sh is echoed to stdout. A caller that
  captures stderr to learn why the launcher failed sees nothing at all, and a
  caller that captures stdout for a VALUE gets the error text mixed into that
  value. Both already happened: BL-944's evidence misread a socket-path
  refusal as "no output".

  Background:
    Given the launcher script swarmforge.sh

  # BL-947 swarmforge-sh-errors-reach-stderr-01
  Scenario: The socket-path refusal reaches stderr
    Given a working directory whose control socket path exceeds the limit
    When the launcher resolves the control socket
    Then the refusal text appears on stderr
    And stdout carries no part of the refusal text

  # BL-947 swarmforge-sh-errors-reach-stderr-02
  Scenario: The refusal still names its reason and still fails
    Given a working directory whose control socket path exceeds the limit
    When the launcher resolves the control socket
    Then the message names the unix-socket path limit as the reason
    And the launcher exits non-zero

  # BL-947 swarmforge-sh-errors-reach-stderr-03
  Scenario: No error message anywhere in the script is left on stdout
    When every error-reporting line in the script is inspected
    Then each one writes to stderr

  # BL-947 swarmforge-sh-errors-reach-stderr-04
  Scenario: A caller capturing the socket path gets only the socket path
    Given a working directory whose control socket path is within the limit
    When the launcher resolves the control socket
    Then stdout carries the socket path and nothing else
