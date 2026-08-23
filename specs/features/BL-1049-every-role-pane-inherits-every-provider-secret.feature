# mutation-stamp: sha256=e01ab7c47ccf5f3d3c813d07001292059154871580989efacd80ec4203793c6c
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-22T14:06:39.660145917Z","feature_name":"The tmux server's global environment carries only the secrets the running configuration needs","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1049-every-role-pane-inherits-every-provider-secret.feature","background_hash":"e2add37118a2e8ca03cce34506f5c1882d89ae0bc3976513f9ab16368008d309","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a provider secret survives the scrub only when the running configuration needs it","scenario_hash":"e68a39f8c251ad23ee8c9e12a9e320e55277d39d81e037d6f237b1e17c60dd39","mutation_count":21,"result":{"Total":21,"Killed":21,"Survived":0,"Errors":0},"tested_at":"2026-08-22T14:06:39.660145917Z"}]}
# acceptance-mutation-manifest-end

Feature: The tmux server's global environment carries only the secrets the running configuration needs

  tmux seeds a new server's global environment from the entire calling shell,
  and every pane opened afterwards inherits a copy. BL-657 established the
  scrub hook for that reason but scoped it to Claude Code and Cursor harness
  markers, so provider credentials still reach every role pane. This feature
  narrows the server's global environment to a keep-list derived from the
  running configuration, leaving the launcher process's own environment alone.

  Narrowing per ROLE - so one vibe pane holds MISTRAL_API_KEY while the claude
  panes beside it do not - is a separate later slice and is asserted nowhere
  here.

  Background:
    Given a launching shell that exports every provider secret on the host
    And a tmux server whose global environment was seeded from that shell

  # BL-1049 provider-secret-scrub-01
  Scenario Outline: a provider secret survives the scrub only when the running configuration needs it
    Given the running configuration's windows all use the "<provider>" backend
    When the swarm scrubs the tmux server's global environment
    Then "tmux show-environment -g" <outcome> "<variable>"

    Examples:
      | variable                      | provider | outcome        |
      | OPENAI_API_KEY                | claude   | does not name  |
      | MISTRAL_API_KEY               | claude   | does not name  |
      | TELEGRAM_BOT_TOKEN            | claude   | does not name  |
      | RESEND_API_KEY                | claude   | does not name  |
      | MISTRAL_API_KEY               | vibe     | still names    |
      | CLAUDE_CODE_OAUTH_TOKEN       | claude   | still names    |
      | CLAUDE_CODE_MAX_OUTPUT_TOKENS | claude   | still names    |

  # BL-1049 provider-secret-scrub-02
  Scenario: a pane opened after the scrub cannot see a scrubbed secret
    Given the running configuration's windows all use the "claude" backend
    And the swarm has scrubbed the tmux server's global environment
    When a role session is created on that server
    Then that pane's own environment does not name "OPENAI_API_KEY"

  # BL-1049 provider-secret-scrub-03
  Scenario: the launcher process keeps the secrets its forked daemons read
    Given the running configuration's windows all use the "claude" backend
    When the swarm scrubs the tmux server's global environment
    Then the launcher process's own environment still names "RESEND_API_KEY"
    And a daemon forked from the launcher after the scrub still reads it

  # BL-1049 provider-secret-scrub-04
  Scenario: the shell twin and the Babashka lib scrub the same set of names
    When the scrub name set is read from the Babashka lib
    And the scrub name set is read from the shell twin
    Then the two sets name exactly the same variables

  # BL-1049 provider-secret-scrub-05
  Scenario: scrubbing a server that is not reachable changes nothing and fails nothing
    Given no tmux server is listening on the socket
    When the swarm scrubs the tmux server's global environment
    Then the scrub reports success
    And no variable is reported as removed
