Feature: BL-1895 A process-group launch works on a host without setsid

  setsid is util-linux and absent from stock macOS, a supported host.
  lander_lib.bb (BL-1872) launches each land with setsid, and
  bounded_run_lib.bb wraps every bounded run in setsid so a timeout can
  kill the whole group. On a host without setsid both fail: the lander
  never starts a land, and every bounded run fails before it begins. Both
  now start their child as a process-group leader through setsid when it
  is on PATH, and through perl's setpgrp when it is not.

  Background:
    Given a fixture whose PATH has perl and bash but no setsid

  # BL-1895 the-lander-launches-a-land-without-setsid-01
  Scenario: the lander sweep launches a queued land on a host without setsid
    Given the lander queue holds an entry for BL-9001
    When the lander sweep runs until the queue is empty
    Then origin/main carries BL-9001's change

  # BL-1895 a-bounded-run-kills-its-group-without-setsid-02
  Scenario: a bounded run that times out on a host without setsid kills its whole process group
    Given a bounded run of a script that starts a child and sleeps past its budget
    When the bounded run's budget passes
    Then neither the script nor its child is still running
