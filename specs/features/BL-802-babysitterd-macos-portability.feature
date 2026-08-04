Feature: BL-802 babysitterd runs on the macOS swarm host

  The deterministic health sweep must start and gather correctly on both
  supported hosts (macOS and Linux). A check that cannot gather reports its
  own unavailability — never a finding about the swarm, never a silent OK.

  Background:
    Given a fixture project root with a .swarmforge directory

  # BL-802 babysitterd-macos-portability-01
  Scenario: daemon start succeeds on a host without setsid
    Given setsid is not resolvable on PATH
    When start_babysitterd.sh starts the daemon
    Then it exits 0 reporting a live pidfile
    And the daemon process outlives the invoking shell

  # BL-802 babysitterd-macos-portability-02
  Scenario: daemon start still succeeds on a host with setsid
    Given a setsid stub is resolvable on PATH
    When start_babysitterd.sh starts the daemon
    Then it exits 0 reporting a live pidfile

  # BL-802 babysitterd-macos-portability-03
  Scenario: pane process gather works on a BSD-style ps
    Given a ps stub on PATH that rejects the --ppid option but supports BSD syntax
    And a pane whose shell has one live child process
    When the sweep gathers that pane's processes
    Then the gather returns the live child
    And the sweep log records no gather failure for that pane

  # BL-802 babysitterd-macos-portability-04
  Scenario Outline: memory floor check reads the memory facility the host has
    Given /proc/meminfo is absent
    And the host memory seam reports <available-mb> MB available
    And the configured memory floor is 1024 MB
    When the sweep runs the memory floor check
    Then the memory floor check <outcome>

    Examples:
      | available-mb | outcome          |
      | 512          | raises a finding |
      | 4096         | stays quiet      |

  # BL-802 babysitterd-macos-portability-05
  Scenario: a failed gather reports the check unavailable, never a swarm finding
    Given every memory facility the sweep knows is absent
    When the sweep runs the memory floor check
    Then no finding is raised by the memory floor check
    And the sweep log records the memory floor check as unavailable
