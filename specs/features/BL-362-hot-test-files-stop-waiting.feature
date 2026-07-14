Feature: The unit suite's two slowest files stop paying for time and work they do not need

# BL-362: the human measured the unit suite at 13s and called it far too slow. Two files dominate:
# paneTailerClass.test.js (~1.8s host) and dependencyGateCli.test.js (~3.3s host).
#
# paneTailerClass ignores BL-131's own injection point: PaneTailer.start() takes an injectable
# scheduleTick/clearTick precisely so tests never wait on wall-clock, and the file already contains
# a fakeScheduler — but only ONE of its ~20 tests uses it; the rest construct a tailer with the real
# setInterval and then await real elapsed intervals (420-1016ms per test). That is the no-real-timers
# ban being violated in the file that most needs it.
#
# dependencyGateCli re-boots the real dependency-cruiser engine once PER TEST (~1s each), six of
# those proving one forbidden-dependency rule apiece over near-identical fixture trees, plus one
# spawn of the compiled CLI over the WHOLE real project inside the unit suite.
#
# LOAD-BEARING CONSTRAINT: the dependency-gate tests exist to prove the REAL pinned checker against
# the REAL project ruleset (BL-259). Sharing one engine run must NOT weaken that — every rule stays
# proven by the real checker over real fixture code, and the full-project scan is moved to the gate
# path where a full scan belongs, never simply deleted. Every millisecond here is re-paid thousands
# of times over in a Stryker run.

# BL-362 hot-test-files-stop-waiting-01
Scenario: The pane-tailer's tests drive its tick instead of waiting for it
  Given the pane-tailer's tests
  When they exercise behavior that happens on a tick
  Then they advance the tailer's tick themselves
  And no pane-tailer test waits on real elapsed time

# BL-362 hot-test-files-stop-waiting-02
Scenario: Every forbidden-dependency rule is still proven by the real checker against real code
  Given the dependency-gate's tests
  When they run
  Then each forbidden-dependency rule is still proven by the real pinned checker over real fixture code

# BL-362 hot-test-files-stop-waiting-03
Scenario: The rules are proven together, not one engine boot at a time
  Given the dependency-gate's tests
  When they prove several forbidden-dependency rules
  Then those rules are proven from a single run of the checker

# BL-362 hot-test-files-stop-waiting-04
Scenario: The whole-project dependency scan still happens, in the gate rather than in the unit suite
  When the unit suite runs
  Then no test scans the whole real project
  And the gate itself still scans the whole real project

# BL-362 hot-test-files-stop-waiting-05
Scenario: The two files get materially faster without losing a single assertion
  When the unit suite runs
  Then the pane-tailer's and dependency-gate's files each take a fraction of the time they took before
  And every behavior those files asserted before is still asserted
