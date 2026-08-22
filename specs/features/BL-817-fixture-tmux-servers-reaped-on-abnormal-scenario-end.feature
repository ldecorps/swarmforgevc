Feature: fixture tmux servers are reaped however a scenario ends, and the live swarm is never touched

  # Six acceptance step files start REAL tmux servers as fixtures and tear them
  # down only from a terminal Then step's hand-rolled cleanup(). A Gherkin
  # mutation pass kills mutants early — the mutant throws long before that
  # terminal step — so the server survives the run. Observed on the BL-807
  # hardening pass: 22 mutations, 5 leaked servers, 2 still alive hours later.
  # BL-458 already built the cure (specs/pipeline/steps/lib/fixtureReaper.js:
  # track() registers a fixture root, and exit/SIGINT/SIGTERM handlers kill its
  # tmux server via the root's .swarmforge/tmux-socket pointer). These six files
  # never adopted it. This ticket is that adoption plus the gate that stops the
  # idiom coming back.
  #
  # The guardrail matters as much as the fix: these fixtures name their sessions
  # `swarmforge-coder`, identical to the live swarm's, so a session-name match
  # would kill the running swarm. Only the socket PATH distinguishes them.

  Background:
    Given a step handler that starts a fixture tmux server on its own socket

  # BL-817 fixture-tmux-server-reaping-01
  Scenario Outline: the fixture's tmux server is reaped however the scenario ends
    Given the handler has registered its fixture root with the shared reaper
    When the scenario ends by "<ending>"
    Then a tmux server on the fixture socket surviving is "<survives>"

    Examples:
      | ending                          | survives |
      | reaching its terminal Then step | no       |
      | a thrown assertion mid-scenario | no       |
      | a mutant failing early          | no       |
      | the runner receiving SIGTERM    | no       |

  # BL-817 fixture-tmux-server-reaping-02
  Scenario Outline: reaping is decided by socket path, never by session name
    Given a live tmux server named "swarmforge-coder" on a socket under "<socket_location>"
    When the shared reaper runs
    Then that server being killed is "<killed>"

    Examples:
      | socket_location                           | killed |
      | the OS temp directory                     | yes    |
      | the repo's .swarmforge/tmux directory     | no     |
      | the repo's .swarmforge/operator directory | no     |

  # BL-817 fixture-tmux-server-reaping-03
  Scenario: a fixture whose server already exited reaps without error
    Given the handler has registered its fixture root with the shared reaper
    And that server has already exited before the reap
    When the shared reaper runs
    Then the reap completes without raising

  # BL-817 fixture-tmux-server-reaping-04
  Scenario: no step handler may start a tmux server without shared reaper coverage
    Given every step handler under specs/pipeline/steps that starts a tmux server
    When the step-handler tmux coverage gate runs
    Then each is reported as covered or uncovered by name
    And a handler relying only on a terminal-step cleanup is reported uncovered
