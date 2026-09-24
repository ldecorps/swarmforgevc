Feature: BL-1704 the swarm stop paths stop the ollama server the swarm started

  BL-1703 records whether the running ollama server was started by the
  swarm or found already running. The full-stack stop and kill_all_swarm
  now stop a swarm-owned server together with its model runner children,
  and leave an external one running, naming it in the stop log. A record
  whose process is gone, or whose pid now belongs to something else, is
  cleared without killing anything. The scenarios use stand-in ollama
  processes.

  Background:
    Given a throwaway project with a stand-in ollama server and one runner child

  # BL-1704 the-swarm-stop-paths-stop-the-ollama-server-01
  Scenario Outline: a stop path stops a swarm-owned server and its runner
    Given the ollama record says the server is "swarm-owned"
    When the operator runs "<stop path>"
    Then neither the server nor its runner child is running
    And the ollama record is gone

    Examples:
      | stop path            |
      | the full-stack stop  |
      | kill_all_swarm       |

  # BL-1704 the-swarm-stop-paths-stop-the-ollama-server-02
  Scenario: a stop leaves an external server running and says so
    Given the ollama record says the server is "external"
    When the operator runs "the full-stack stop"
    Then the server and its runner child are still running
    And the stop log names the external server as left running

  # BL-1704 the-swarm-stop-paths-stop-the-ollama-server-03
  Scenario Outline: a record that no longer matches a live server is cleared without killing anything
    Given the ollama record says the server is swarm-owned with a pid that <pid state>
    When the operator runs "the full-stack stop"
    Then no process was signalled
    And the ollama record is gone and the stop log says why

    Examples:
      | pid state                           |
      | is no longer running                |
      | now belongs to a process that is not ollama serve |
