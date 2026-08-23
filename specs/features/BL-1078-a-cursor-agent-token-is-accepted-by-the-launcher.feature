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
