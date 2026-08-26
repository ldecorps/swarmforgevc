Feature: A sanctioned detached job survives the orphan reaper

  Two standing mechanisms contradict each other. The hardender's role prompt
  states that a run needing more than ~120s escapes the cap ONLY via a
  python3 double-fork with os.setsid, because the tool timeout,
  run_in_background and nohup all fail on this host. That detach produces a
  PPID-1 orphan by construction.

  The handoffd supervisor's BL-108 reaper kills any PPID-1 orphan whose
  command line matches its job pattern - Stryker, node --test, npx vitest,
  npm exec vitest, vitest.properties.config.mjs. Those are exactly the runs
  the hardener detaches.

  So the sanctioned mechanism is destroyed by the guardrail, and the job
  simply vanishes: the only trace is a supervisor log line the owning agent
  has no reason to read.

  Background:
    Given the orphan job reaper is running

  # BL-995 registered-detach-survives-01
  Scenario: A job detached the sanctioned way keeps running
    Given a long job detached the sanctioned way and registered as deliberate
    When the reaper sweeps
    Then the job is still running

  # BL-995 crash-orphan-is-still-reaped-02
  Scenario: A crash-orphaned job is still killed
    Given a job process orphaned by a crash and never registered
    When the reaper sweeps
    Then the job is killed

  # BL-995 abandoned-registration-is-not-immunity-03
  Scenario: A registered job nobody ever collected is eventually killed
    Given a registered job whose owner never collected it
    And its registration has aged past its limit
    When the reaper sweeps
    Then the job is killed

  # BL-995 a-reaped-job-tells-its-owner-04
  Scenario: An agent collecting a killed run learns it was reaped
    Given a registered job is killed by the reaper
    When the owning agent collects that run
    Then the run's own log names the reaping as the cause
