Feature: BL-1779 A root that declares no swarm name never takes a fleet swarm's Telegram identity
  A front desk resolves its Telegram identity from the fleet creds file of
  its own swarm name. A project root with no swarm identity of its own,
  which is what every test fixture root is, used to fall back to the
  primary's name. Under the host's real HOME that handed it the primary's
  bot token and bridge port. A fixture then ran a second poller on the
  human's bot and freed the live bridge's port, and in the bootstrap
  window it recorded itself as the primary root. An undeclared root now
  reads no fleet creds file and writes no primary-root record. It
  resolves only through the environment fallback BL-622 already defines.

  Background:
    Given a fixture fleet home whose primary creds file names bot token "primary-token" and bridge port 18765

  # BL-1779 an-undeclared-root-never-resolves-a-fleet-creds-file-01
  Scenario Outline: an undeclared root never resolves a fleet creds file
    Given the fixture fleet home <record state>
    And a fixture project root with no swarm identity
    When the creds CLI resolves that root with environment bridge port 18999
    Then the resolved bot token is not "primary-token"
    And the resolved bridge port is not 18765

    Examples:
      | record state                                  |
      | records another checkout as the primary root  |
      | has no primary-root record                    |

  # BL-1779 an-undeclared-root-never-records-itself-as-primary-02
  Scenario: an undeclared root's front desk never records itself as the primary root
    Given the fixture fleet home has no primary-root record
    And a fixture project root with no swarm identity
    When that root's front-desk supervisor starts and stops
    Then the fixture fleet home still has no primary-root record

  # BL-1779 a-declared-root-keeps-its-own-creds-03
  Scenario: a root that declares its swarm name still resolves its own creds file
    Given a fixture project root whose swarm identity declares "primary"
    When the creds CLI resolves that root with environment bridge port 18999
    Then the resolved bot token is "primary-token"
    And the resolved bridge port is 18765
