# mutation-stamp: sha256=9a126b46b4416d7a4a70e72897700cf66555778dbc9b44f40426342bc1b54701
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-23T05:43:40.780718433Z","feature_name":"a pack window line naming cursor staffs a real seat","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1078-a-cursor-agent-token-is-accepted-by-the-launcher.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the launcher's allow-list verdict for an agent token","scenario_hash":"cb70d3c4d0af3fc66501e5148e262d6813269072f1ff3530a60d56f762cce532","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-23T05:43:40.780718433Z"},{"index":3,"name":"a cursor seat boots its own role in its own worktree","scenario_hash":"1a23bbb47cc089b38210c727dd972079cab0fc7421ec7c343201b3b69bb47463","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-23T05:43:40.780718433Z"},{"index":5,"name":"an uncertified cursor identity needs a deliberate escape","scenario_hash":"42cc42c3a28322c7693b2707ed85113089b16d4229aba2bbd69eff21d1c2a6e8","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-23T05:43:40.780718433Z"}]}
# acceptance-mutation-manifest-end

Feature: a pack window line naming cursor staffs a real seat

  BL-1078: the launcher's agent allow-list is
  `claude|codex|copilot|grok|aider|vibe|gemini`. A pack that names `cursor` on
  a window line is refused at launch, so no ordinary pack can staff a seat
  with a Cursor agent however well that agent works.

  `cursor-agent` is a terminal-native coding agent CLI, the same shape the
  launcher already drives for `vibe`, `gemini` and `grok`: it takes a
  workspace directory, a trust/force flag, a model flag and an initial prompt
  argument, and it runs interactively in a pane. A Cursor seat is therefore an
  ordinary tmux-resident agent, not a process the extension host spawns — the
  substrate stays tmux, per the two-layer architecture rule.

  This slice makes `cursor` a first-class agent token across the four places a
  token has to be known: the launcher's allow-list, its backend-dependency
  check, its per-agent launch command, and the agent-runtime provider table
  that decides how a seat is woken. Until the provider table knows the token,
  an unknown agent normalises to the `claude` fallback and a Cursor seat is
  woken with the wrong wake style while every check still reads green.

  A Cursor identity is not certified by this slice. Admitting one onto a pack
  needs an explicit escape until BL-1079 lands steward certification; every
  scenario below holds the identity uncertified, so BL-1079 adds the certified
  path beside them rather than falsifying them.

  # BL-1078 cursor-agent-token-accepted-by-the-launcher-01
  Scenario Outline: the launcher's allow-list verdict for an agent token
    Given a pack window line naming role documenter with agent <agent>
    When the launcher validates that line's agent
    Then the agent token is <verdict>

    Examples:
      | agent    | verdict  |
      | cursor   | accepted |
      | claude   | accepted |
      | cursorly | refused  |

  # BL-1078 cursor-agent-token-accepted-by-the-launcher-02
  Scenario: a cursor window line makes the cursor binary a launch dependency
    Given a pack window line naming role documenter with agent cursor
    When the launcher checks that pack's backend dependencies
    Then the cursor agent binary is among the dependencies checked
    And a host without that binary is refused before any window is opened

  # BL-1078 cursor-agent-token-accepted-by-the-launcher-03
  Scenario: a cursor seat is woken by its own provider entry, not the fallback
    Given the agent-runtime provider table
    When the wake style for agent cursor is resolved
    Then it comes from a provider entry declared for cursor
    And agent cursor is not normalised to the unknown-agent fallback

  # BL-1078 cursor-agent-token-accepted-by-the-launcher-04
  Scenario Outline: a cursor seat boots its own role in its own worktree
    Given a pack window line naming role <role> with agent cursor
    When the launcher builds that seat's launch command
    Then the command starts the cursor agent in that role's worktree
    And it carries that role's composed prompt bundle

    Examples:
      | role       |
      | documenter |
      | coder      |

  # BL-1078 cursor-agent-token-accepted-by-the-launcher-05
  Scenario: a cursor seat takes and hands on work through the shared helpers
    Given a cursor seat provisioned by the launcher
    When the channels it uses to take work and to hand work on are enumerated
    Then its wake is delivered by the shared agent-runtime notify path
    And its handoff draft path is the path every other agent writes
    And no enumerated channel reaches the swarm outside the mailbox

  # BL-1078 cursor-agent-token-accepted-by-the-launcher-06
  Scenario Outline: an uncertified cursor identity needs a deliberate escape
    Given a pack window line naming role documenter with agent cursor
    And the cursor identity is not certified in the model steward registry
    And the uncertified-cursor escape is <escape>
    When the launcher provisions that seat
    Then the seat is <verdict>
    And the launcher states <stated reason>

    Examples:
      | escape | verdict  | stated reason                    |
      | unset  | refused  | the escape that would admit it   |
      | set    | admitted | that the identity is uncertified |
