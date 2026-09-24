Feature: BL-1727 Stopping a started ollama server waits until it is gone

  A launch that starts ollama and then refuses, and the swarm's stop paths,
  stop the server through one shared helper. The helper sends one TERM and
  returns at once, so a caller that reports the server stopped may be
  wrong. A real server can take seconds to shut down or ignore TERM
  altogether. On 2026-09-24 BL-1703's own property caught the started
  process still alive right after a refused launch, under load. This
  feature is that the helper returns only once the process is gone,
  escalating to KILL after a bound, and says so when even that fails.

  Background:
    Given a fixture process started the way the launch starts the ollama server

  # BL-1727 stop-returns-only-when-the-process-is-gone-01
  Scenario Outline: the stop helper returns with the process gone
    Given the process <behaviour>
    When the stop helper is called on its pid
    Then the helper succeeds
    And the pid is not alive the moment the helper returns

    Examples:
      | behaviour                                    |
      | exits two seconds after receiving TERM       |
      | ignores TERM                                 |
      | has already exited                           |

  # BL-1727 a-stop-that-cannot-end-the-process-says-so-02
  Scenario: a process that outlives the KILL escalation is reported
    Given the process cannot be signalled by this user
    When the stop helper is called on its pid
    Then the helper fails naming the pid that is still alive
