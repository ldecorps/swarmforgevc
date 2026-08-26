Feature: long-running daemons unwatched by freshness conf

  # BL-784: supervisor per-tick heartbeats, conf rows, registry guard.

  # BL-784 registry-guard-passes-01
  Scenario: registry guard passes on the shipped fixture conf
    Given the shipped daemon_log_freshness fixture conf
    When the registry guard runs
    Then the guard exits successfully

  # BL-784 registry-guard-fails-missing-row-02
  Scenario: registry guard fails when a required daemon lacks a conf row
    Given a required daemon list that includes an unregistered name
    When the registry guard runs
    Then the guard names the unregistered daemon

  # BL-784 quiet-supervisor-not-restarted-03
  Scenario: a fresh supervisor heartbeat is not restarted by the checker
    Given a handoffd_supervisor with a fresh heartbeat log
    When the freshness checker runs against the fixture conf
    Then the supervisor process is not killed
