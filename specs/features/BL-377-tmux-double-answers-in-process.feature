Feature: The tmux test double answers in-process instead of spawning a process

  test/helpers/fakeTmux.js installs a REAL Node executable onto PATH, so every tmux
  call the code under test makes is a real child-process spawn (~30-50ms). A single
  PaneTailer poll makes 3-4 of them, and a test polls repeatedly — which is what
  actually makes paneTailerClass (9.8s) and tmuxClient (8.3s) slow. Eleven test files
  pay this tax, so the win reaches well past the two poles.

  The engineering rules already prefer test doubles over real collaborators, and tmux
  is the environmentally-unsuitable boundary. An in-process double is therefore both
  faster AND more compliant — it is not "mocking to hit a number".

  One case genuinely cannot use it: swarmLauncher spawns the real ./swarm script,
  which resolves tmux from PATH inside its own child process, where an in-process
  double cannot reach. That test keeps the PATH-executable fake. Both doubles must
  therefore coexist, driven from one shared rules format.

  # BL-377 in-process-tmux-double-01
  Scenario: An in-process caller's tmux call is served without spawning anything
    Given a test installs the in-process tmux double
    When code under test invokes tmux
    Then the double returns the configured exit code and output
    And no child process is spawned

  # BL-377 in-process-tmux-double-02
  Scenario: The double records the exact argv the code under test built
    Given a test installs the in-process tmux double
    When code under test invokes tmux
    Then the recorded call log shows the exact argv, as the spawned fake recorded it

  # BL-377 in-process-tmux-double-03
  Scenario: Rules can be replaced mid-test to simulate a state change
    Given a test installs the in-process tmux double reporting a live session
    When the rules are replaced so the session reads as dead
    Then the next tmux call reports the session as dead

  # BL-377 in-process-tmux-double-04
  Scenario: A genuine subprocess boundary keeps the PATH-executable fake
    Given a test whose code under test spawns a script that resolves tmux from PATH itself
    When that test installs the PATH-executable tmux fake
    Then the spawned script finds the fake on PATH and the test passes unchanged

  # BL-377 in-process-tmux-double-05
  Scenario: The double restores whatever it replaced
    Given a test installs the in-process tmux double
    When the test finishes and the double is uninstalled
    Then the seam it replaced is restored exactly as it was found
