Feature: BL-1780 A front-desk supervisor never signals a healthy bridge that serves another project root
  Before it spawns its bridge, a front-desk supervisor checks what holds
  its bridge port (BL-789). A healthy bridge of its own root is adopted.
  Anything else was freed with kill -TERM, then -KILL, including a
  healthy bridge serving a DIFFERENT project root. That bridge is another
  swarm's live front desk: two swarms on one host resolving the same
  port, or a fixture resolving the host's port, would take it down. A
  healthy bridge of another root is now left alone. The supervisor
  starts no bridge of its own and says why. An unhealthy bridge, and a
  listener that is not a bridge, are still freed as BL-789 specifies.

  Background:
    Given a fixture project root that declares its own swarm name and bridge port

  # BL-1780 the-holder-of-our-port-decides-its-fate-01
  Scenario Outline: what holds the bridge port decides whether it is freed
    Given <holder> holds the fixture's bridge port
    When the fixture root's front-desk supervisor runs one check
    Then the holder <fate>

    Examples:
      | holder                                          | fate                                         |
      | a healthy bridge serving another project root   | is still running and no bridge was started   |
      | an unhealthy bridge serving another project root | was stopped and the fixture's bridge started |

  # BL-1780 the-supervisor-says-why-02
  Scenario: the supervisor says why it started no bridge
    Given a healthy bridge serving another project root holds the fixture's bridge port
    When the fixture root's front-desk supervisor runs one check
    Then the supervisor log names the bridge port and the other project root
