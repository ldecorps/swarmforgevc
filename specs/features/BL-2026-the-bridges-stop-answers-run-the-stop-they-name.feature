Feature: The bridge's stop answers run the stop they name

  Two Host-topic answers stop the swarm. When a /land queue clears, the
  bridge asks "Drain-stop the swarm now?", and a yes wrote the swarm bounce
  sentinel: a stop-and-relaunch request, and on a host with no extension
  host nothing at all, while the reply said "drain-stop requested". Stop &
  run, offered when /pilot meets a live swarm, runs the emergency stop
  while BL-698's how-to describes it as a drain-stop. Each answer now runs
  the stop it names, and its reply says which one ran.

  # BL-2026 land-sleep-answer-runs-the-stop-it-names-01
  Scenario Outline: an answer to the land queue's drain-stop question runs only the stop it names
    Given a land batch whose in-flight queue has just emptied
    When the principal answers "<answer>" to the land queue's drain-stop question
    Then the stop that runs is "<stop>"
    And no bounce sentinel is written

    Examples:
      | answer | stop        |
      | yes    | /stop drain |
      | no     | none        |

  # BL-2026 stop-and-run-names-its-stop-02
  Scenario: the Stop & run reply names the stop mode that ran
    Given the swarm's tmux sessions are live
    When the principal confirms Stop & run for "/pilot BL-900"
    Then the reply names the stop mode that ran
