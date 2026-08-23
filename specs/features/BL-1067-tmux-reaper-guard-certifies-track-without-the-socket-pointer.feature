Feature: the tmux-reaper guard certifies a reaper that cannot reach the server

  BL-817's guard keeps every step handler that starts a fixture tmux server
  wired to the shared fixtureReaper. It draws a FILE-LEVEL trust boundary and
  says so: a file that requires ./lib/fixtureReaper and calls track()
  somewhere "is trusted to have wired them together correctly".

  For the tmux half that trust is misplaced, because there is a third
  ingredient the check has no representation of. reap(root) finds a fixture's
  tmux server one way only: it reads <root>/.swarmforge/tmux-socket and passes
  the contents to killTmuxServer. track() registers the root for the
  exit/SIGINT/SIGTERM handlers and never discovers a socket, and every read in
  reap() is deliberately best-effort, so a missing pointer file is not an
  error, not a warning, and not a log line. The tmux branch simply does not
  run.

  So a step file can spawn a real server on its own socket, call track(root),
  write no pointer file, and be CLEAN by this guard — in the whole-tree
  assertion extension/test/tmuxReaperGuard.test.js runs on every parcel. The
  leak is invisible from inside the run: the suite passes either way and the
  servers are detached, so nothing in the report changes.

  BL-1049 is the live instance. Its provider-secret scrub steps started a real
  server per scenario on <root>/bl1049.sock and called track(root) with no
  pointer file; two runs each left nine real tmux servers alive, and the guard
  was green throughout.

  The mirror-image hazard is what makes the obvious fix wrong, and BL-1032
  already paid for that lesson once. A file that cannot start a REAL server
  must never be asked for a pointer file — demanding one from a query-only
  file, from a file that merely asserts about tmux argv, or from a PATH stub
  that no real server is ever listening behind, is the same lie in the
  opposite direction: wiring that guards nothing, adopted to satisfy a gate.

  Background:
    Given the tmux-reaper guard scanning the step-handler tree

  # BL-1067 tmux-reaper-socket-pointer-01
  Scenario: track() without a socket pointer is flagged
    Given a step file that starts a real tmux server on a socket of its own
    And that file requires the fixture reaper and calls track()
    And that file never teaches the reaper where its socket is
    When the guard scans it
    Then the guard reports a violation for that file
    And the reason names the missing socket pointer

  # BL-1067 tmux-reaper-socket-pointer-02
  Scenario: track() with a socket pointer is clean
    Given a step file that starts a real tmux server on a socket of its own
    And that file requires the fixture reaper and calls track()
    And that file teaches the reaper where its socket is
    When the guard scans it
    Then the guard reports no violation for that file

  # BL-1067 tmux-reaper-socket-pointer-03
  Scenario Outline: a file that starts no real server is never asked for a socket pointer
    Given a step file that <shape>
    And that file never teaches the reaper where its socket is
    When the guard scans it
    Then the guard reports no violation for that file

    Examples:
      | shape                                              |
      | only queries tmux for sessions it did not start    |
      | only asserts about tmux argv it evaluates as data  |
      | puts a no-op tmux stub on PATH that starts nothing |

  # BL-1067 tmux-reaper-socket-pointer-04
  Scenario: the real step-handler tree is clean under the strengthened guard
    Given the step handlers as committed
    When the guard scans the whole tree
    Then the guard reports no violations
