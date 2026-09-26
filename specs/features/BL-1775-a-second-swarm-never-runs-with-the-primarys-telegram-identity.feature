Feature: BL-1775 A second swarm never runs with the primary's Telegram identity

  zsh sources ~/.zshenv for every invocation, and on this host that file
  exports the primary swarm's TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.
  swarmforge.sh and every role launch script it writes are zsh scripts, so
  every pane and every daemon of a second swarm started with the primary's
  bot and chat: verified by hash on gpu-bargain-hunter's handoffd and
  coordinator on 2026-09-26. Any sender there that reads the environment
  would post into the primary's group, and a poller would steal its inbound
  (BL-380, BL-622). The front desk alone was isolated (BL-436); the rest of
  the launch was not.

  Here a swarm that is not the recorded primary root carries its own fleet
  credentials (~/.swarmforge/fleet/<swarm_name>/telegram.json), or none at
  all, in its launcher and in every role launch script, applied after the
  shell profile so the profile can no longer win. The primary swarm keeps
  its environment exactly as today. Every scenario runs under a fixture
  home directory with fake tokens, never the real home or a real bot.

  Background:
    Given a fixture home whose .zshenv exports TELEGRAM_BOT_TOKEN "primary-token" and TELEGRAM_CHAT_ID "-1001"
    And the fixture home records a primary root that is not the fixture target

  # BL-1775 a-second-swarm-carries-its-own-identity-or-none-01
  Scenario Outline: a second swarm's processes see its own Telegram identity or none, never the primary's
    Given the fixture target's swarm is named "second" <creds>
    When <process> for the fixture target prints its Telegram environment under zsh
    Then it sees TELEGRAM_BOT_TOKEN "<token>" and TELEGRAM_CHAT_ID "<chat>"

    Examples:
      | creds                                                             | process                                           | token        | chat  |
      | with a fleet creds file for token "second-token" and chat "-1002" | a role launch script swarmforge.sh wrote          | second-token | -1002 |
      | with a fleet creds file for token "second-token" and chat "-1002" | a daemon started from swarmforge.sh's environment | second-token | -1002 |
      | with no fleet creds file                                          | a role launch script swarmforge.sh wrote          |              |       |
      | with no fleet creds file                                          | a daemon started from swarmforge.sh's environment |              |       |

  # BL-1775 every-role-launch-script-applies-the-identity-02
  Scenario: every role launch script written for a second swarm applies its identity
    Given the fixture target's swarm is named "second" with a fleet creds file for token "second-token" and chat "-1002"
    When swarmforge.sh writes the role launch scripts for the fixture target's pack
    Then each role launch script it wrote prints TELEGRAM_BOT_TOKEN "second-token" under zsh
    And the number of role launch scripts checked equals the number of roles the fixture pack names

  # BL-1775 the-primary-swarm-is-unchanged-03
  Scenario: the recorded primary root keeps the token its environment carries
    Given the fixture target is the recorded primary root
    When a role launch script swarmforge.sh wrote for the fixture target prints its Telegram environment under zsh
    Then it sees TELEGRAM_BOT_TOKEN "primary-token" and TELEGRAM_CHAT_ID "-1001"
