Feature: The standing host-agent Telegram topic is named Host
  The human renamed the standing host-agent control topic to Host by hand in
  live Telegram, but the code still titles it Cursor Remote — so a fresh group
  would silently undo the rename. The display name becomes Host while the
  binding subject id stays CURSOR_REMOTE, so the already-bound thread keeps
  working. Source: human via Let's Talk 2026-07-30; BL-725.

  Background:
    Given the cursor bridge topic constants are loaded

  # BL-725 host-topic-01
  Scenario Outline: the standing topic constants carry the intended values
    When the standing host-agent <field> is read
    Then its value is <value>

    Examples:
      | field      | value         |
      | topic name | Host          |
      | subject id | CURSOR_REMOTE |

  # BL-725 host-topic-02
  Scenario: the old display name is gone from the topic constant
    When the standing host-agent topic name is read
    Then its value is not Cursor Remote

  # BL-725 host-topic-03
  Scenario: a newly created topic is titled Host
    Given a Telegram group with no bound host-agent topic
    When the bridge ensures its host-agent topic
    Then it creates one forum topic titled Host

  # BL-725 host-topic-04
  Scenario: an already-bound topic is reused, never recreated
    Given a Telegram group whose topic map binds thread 4242 to subject CURSOR_REMOTE
    When the bridge ensures its host-agent topic
    Then it reuses thread 4242
    And it creates no forum topic

  # BL-725 host-topic-05
  Scenario Outline: operator-facing copy names the topic Host
    When the operator-facing text <source> is read
    Then it names the topic Host
    And it does not name the topic Cursor Remote

    Examples:
      | source                    |
      | the pilot status prompt   |
      | the unknown-verb reply    |
      | the topic-ownership error |

  # BL-725 host-topic-06
  Scenario: the host-agent flow diagram labels the topic Host
    When the host-agent flow diagram is read
    Then it names the topic Host
