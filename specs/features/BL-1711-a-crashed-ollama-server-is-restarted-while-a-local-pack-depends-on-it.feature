Feature: BL-1711 a crashed ollama server is restarted while a local pack depends on it

  BL-1703 starts and probes ollama when a pack that uses the local model
  endpoint launches, and records the server. Nothing notices if that
  server then dies mid-shift: every local seat's next request fails and
  keeps failing. handoffd now watches the recorded server. When its
  process is gone and the endpoint has stayed silent across the
  confirmation window, handoffd reaps the dead server's orphaned runners,
  starts a new server the BL-1703 way, records it as swarm-owned and
  raises one alert. A server whose process is alive but not answering is
  never killed (a large model can take minutes to load on CPU), a single
  missed probe changes nothing, and repeated crashes stop being restarted
  after a bound. The scenarios use a stand-in ollama binary and endpoint.

  Background:
    Given a throwaway project whose ollama record names a stand-in server on a stand-in endpoint

  # BL-1711 a-crashed-ollama-server-is-restarted-01
  Scenario Outline: a crashed server is restarted once and recorded as swarm-owned
    Given the record says the server is "<owner>"
    And the server's process has exited and the endpoint stays silent through the confirmation window
    When handoffd's ollama restart sweep runs until the window has passed
    Then exactly one new server was started and the endpoint answers again
    And the record says "swarm-owned" with the new server's pid
    And exactly one alert names the crash and the restart

    Examples:
      | owner       |
      | swarm-owned |
      | external    |

  # BL-1711 a-crashed-ollama-server-is-restarted-02
  Scenario Outline: a server that has not crashed is left alone
    Given the record says the server is "swarm-owned"
    And <state>
    When handoffd's ollama restart sweep runs until the window has passed
    Then no server was started and no process was signalled

    Examples:
      | state                                                                       |
      | the server's process is alive but the endpoint stays silent                 |
      | the endpoint misses one probe and then answers                              |

  # BL-1711 a-crashed-ollama-server-is-restarted-03
  Scenario: an orphaned runner of the crashed server is reaped before the new server starts
    Given the record says the server is "swarm-owned"
    And the server's process has exited and the endpoint stays silent through the confirmation window
    And a runner the dead server started is still running
    When handoffd's ollama restart sweep runs until the window has passed
    Then the orphaned runner was ended before the new server was started

  # BL-1711 a-crashed-ollama-server-is-restarted-04
  Scenario: repeated crashes stop being restarted after the bound
    Given the record says the server is "swarm-owned"
    And the server has been restarted 3 times in the last 30 minutes
    And the server's process has exited and the endpoint stays silent through the confirmation window
    When handoffd's ollama restart sweep runs until the window has passed
    Then no server was started and no process was signalled
    And exactly one escalation says restarts are exhausted and names the server log

  # BL-1711 a-crashed-ollama-server-is-restarted-05
  Scenario: with no ollama record nothing is probed or started
    Given there is no ollama record
    When handoffd's ollama restart sweep runs until the window has passed
    Then no endpoint probe ran and no server was started
