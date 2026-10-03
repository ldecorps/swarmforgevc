Feature: An orphan adopted by a subreaper is an orphan

  process_table_lib.bb's parent-orphaned? reads a process as orphaned when
  its parent is PID 1, has exited, or cannot be found. A Linux host can
  name a child subreaper instead of PID 1: WSL gives each session a Relay
  /init that adopts every orphan below it, and systemd --user does the same
  on a desktop. On this host every orphan is adopted by such a process
  (PID 5772, live), so parent-orphaned? never reads it as orphaned. The
  three reapers that consult the predicate, BL-928's onboarder startup
  reap, BL-108's handoffd job reaper and the orphan janitor, never fire
  here.

  On 2026-10-03 a leaked onboarder reconcile poll-loop from 22:02Z was
  running against the live root beside the live supervisor's own loop. A
  test fixture's front-desk bridge was holding on after its test ended.
  Two standing shell tests that orphan a process on purpose were red,
  because each one waits for PPID 1.

  The swarm's own daemons are detached on purpose, and on this host they
  are parented to that same Relay /init. A reaper must still never take
  one of them. Its own candidate filter is what keeps it off them, as it
  is on a PID-1 host today.

  # BL-1907 an-adopted-orphan-reads-orphaned-01
  # The fixture makes the subreaper itself (prctl PR_SET_CHILD_SUBREAPER),
  # so the row holds on any Linux host, whatever adopts orphans there.
  Scenario Outline: the shared orphan predicate reads who parents a process
    Given a fixture subreaper process
    And a process below it whose parent is <parent>
    When process_table_lib.bb's parent-orphaned? reads that process
    Then it reads orphaned: "<orphaned>"

    Examples:
      | parent                                   | orphaned |
      | the subreaper, after its starter exited  | yes      |
      | its starter, still running               | no       |

  # BL-1907 standing-reap-tests-pass-on-a-subreaper-host-02
  # Each runner is measured at about 25 s and 5 s on this host, inside the
  # per-mutant ceiling (BL-1541).
  Scenario Outline: a standing reaper test that orphans a process on purpose passes on this host
    When the standing shell test "<test>" runs
    Then it exits 0

    Examples:
      | test                                    |
      | test_onboarder_supervisor_tick.sh       |
      | test_handoffd_supervisor_job_reaper.sh  |
