Feature: Daemon email capability survives relaunch or fails loudly to the operator

  RESEND_API_KEY deliberately lives only in the daemon's process environment
  (BL-215) - never in the repo. That posture is kept. The defect (2026-08-20):
  a daemon generation relaunched from a shell without the key silently loses
  ALL email capability - briefing sweep (BL-214) and death alarm (BL-144)
  alike - and the only trace is the daemon's own log. The operator's first
  signal was a briefing that never arrived.

  Two legs, one observable outcome: after any relaunch, either email still
  works (the launch path re-sources the operator's env file
  .swarmforge/operator/daemon.env when it exists), or the operator hears
  about it through Telegram - a transport that needs no email key - within
  the first sweep cycle. Every scenario drives the bb libs through their
  existing adapter seams over fixtures: injected env lookup, fixture
  transports, scratch dirs. No live daemon, no real key, no real send.

  Background:
    Given a conf with notify_email_to configured
    And a fixture briefings directory with one unsent in-window briefing

  # BL-976 email-key-01
  Scenario: a keyless launch alerts the operator through Telegram within the first sweep
    Given a daemon environment with no RESEND_API_KEY
    When the first briefing sweep of the daemon generation runs
    Then exactly one keyless-email alert is delivered through the Telegram operator transport
    And the alert names RESEND_API_KEY and the env file the launch path looks for
    And the briefing is skipped, not treated as sent

  # BL-976 email-key-02
  Scenario: the keyless alert fires at most once per daemon generation
    Given a daemon environment with no RESEND_API_KEY
    When three consecutive briefing sweeps of the same daemon generation run
    Then exactly one keyless-email alert is delivered through the Telegram operator transport
    And the briefing is skipped, not treated as sent

  # BL-976 email-key-03
  Scenario: the launch path re-sources the operator env file when it exists
    Given an operator env file defining RESEND_API_KEY
    And a launch shell environment with no RESEND_API_KEY
    When the daemon is launched through the standard launch script
    Then the daemon's email-capability decision sees the key
    And the briefing sweep sends the unsent briefing through the fixture email transport

  # BL-976 email-key-04
  Scenario: no env file and no ambient key degrades exactly as before, plus the alert
    Given no operator env file exists
    And a launch shell environment with no RESEND_API_KEY
    When the daemon is launched through the standard launch script
    Then the launch completes without error
    And the briefing is skipped, not treated as sent
    And exactly one keyless-email alert is delivered through the Telegram operator transport

  # BL-976 email-key-05
  Scenario: the key's value never reaches a log line
    Given an operator env file defining RESEND_API_KEY
    When the daemon is launched through the standard launch script
    And the first briefing sweep of the daemon generation runs
    Then no log line produced by launch or sweep contains the key's value

  # BL-976 email-key-06
  Scenario: a briefing stranded by a keyless generation sends itself once a keyed generation runs
    Given a briefing skipped by a keyless daemon generation
    And the briefing is still within the send window
    When a later daemon generation runs with RESEND_API_KEY present
    Then the briefing sweep sends the unsent briefing through the fixture email transport
    And the briefing is recorded as sent exactly once
