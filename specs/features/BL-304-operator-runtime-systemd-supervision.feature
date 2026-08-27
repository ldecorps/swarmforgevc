Feature: A systemd unit supervises the operator runtime so it autostarts, restarts on crash, and survives a reboot without ever permanently giving up

  Background:
    Given the operator-runtime systemd unit is generated for a host

  # BL-304 operator-autostart-01
  Scenario: the unit restarts the runtime and never permanently gives up
    When the generated unit is inspected
    Then it restarts the runtime whenever the process exits
    And a burst of rapid crashes never leaves the runtime permanently stopped

  # BL-304 operator-autostart-02
  Scenario: the unit starts the runtime at boot
    When the generated unit is inspected
    Then it is enabled to bring the runtime up at boot

  # BL-304 operator-autostart-03
  Scenario: the unit carries the operator's secrets into the clean systemd environment
    When the generated unit is inspected
    Then it loads the operator's environment file instead of relying on a login shell
