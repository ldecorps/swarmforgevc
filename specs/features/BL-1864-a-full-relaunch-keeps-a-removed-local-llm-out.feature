Feature: BL-1864 A full relaunch keeps a removed local LLM out

  BL-1861's remove takes the local-model seats out of the running swarm
  so the human can give the local LLM or the GPU to a task outside the
  swarm. A full launch rebuilds the roster from the pack, and the pack
  still declares those seats, so the next relaunch (a bounce, the day
  shift starting, a ceremony restart) would bring them back and load the
  model onto a card the outside task is using. While
  `.swarmforge/local-llm/removed.json` exists, a full launch now leaves
  every local-model seat the record names out of the roster, starts no
  session for it, asks the model server nothing for it, and says so. It
  still writes the seat's worktree and launch script, and it refreshes
  the record with the rows it would have written, so BL-1862's add later
  brings back the seat the pack now declares.

  Background:
    Given a fixture pack declaring the Claude seats "coder" and "coordinator" and the local-model seat "coder@2"

  # BL-1864 a-launch-keeps-a-removed-seat-out-01
  Scenario: a launch while the removal record names a seat leaves that seat out
    Given the removal record names "coder@2"
    When the swarm is launched from the fixture pack
    Then no roster copy lists "coder@2" and no session is started for it
    And the model server is asked nothing for "coder@2"
    And the launch output names "coder@2" as kept out until local_llm add
    And the removal record holds the rows this launch would have written for "coder@2"
    And the launch script of "coder@2" is written

  # BL-1864 a-launch-with-no-record-starts-the-seat-02
  Scenario: a launch with no removal record starts the local-model seat as before
    Given no removal record exists
    When the swarm is launched from the fixture pack
    Then every roster copy lists "coder@2" and its session is started

  # BL-1864 add-after-a-relaunch-brings-the-seat-back-03
  Scenario: add after such a launch brings the seat back with the pack's current row
    Given a launch left "coder@2" out because the removal record named it
    When the operator runs local_llm add
    Then every roster copy lists "coder@2" with the row that launch would have written
    And its session is started from the launch script that launch wrote
