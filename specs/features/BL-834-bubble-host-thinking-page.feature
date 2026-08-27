Feature: Bubble's Host page is a window onto the host agent working, and never a spinner

  The human can watch a tmux pane on the laptop and has no equivalent on the
  phone, so they only intervene after a wrong path has already burned tokens.
  This page renders the BL-833 activity feed live: seeded from the buffer on
  open, then pushed. It is a window, not a cockpit — nothing done here reaches
  the host agent.

  Because the human ruled that Bubble's screens ship as remote HTML in the UI
  bundle, this is bridge-side TypeScript and runs in the Node acceptance runner.

  Background:
    Given a running swarm and the bridge started via its opt-in command

  # BL-834 host-page-live-during-turn-01
  Scenario: activity appears while the turn is still running
    Given a host agent turn is in progress and has emitted progress lines
    When the Host page is rendered for Bubble
    Then it shows those lines before the turn's reply is produced

  # BL-834 host-page-seeds-then-attaches-02
  Scenario: opening late catches up, then keeps up
    Given a host agent turn already emitted lines before the page was opened
    When the Host page is rendered for Bubble
    Then it shows the lines already buffered for the session
    And it attaches to the live push channel for the rest of the turn

  # BL-834 host-page-three-states-03
  Scenario Outline: each condition has its own honest rendering
    Given <condition>
    When the Host page is rendered for Bubble
    Then it renders the <state> state
    And it does not render a perpetual loading state

    Examples:
      | condition                          | state       |
      | a host agent session is active     | working     |
      | no host agent session is active    | quiet       |
      | the activity feed cannot be read   | unreachable |

  # BL-834 host-page-unreachable-states-reason-04
  Scenario: an unreachable feed says why
    Given the activity feed cannot be read and the bridge supplies a reason
    When the Host page is rendered for Bubble
    Then that reason is shown
    And a bare status code is not the whole message

  # BL-834 host-page-renders-only-the-feed-05
  Scenario: the page adds nothing to what the host emitted
    Given a host agent turn has emitted a known set of progress lines
    When the Host page is rendered for Bubble
    Then every line it shows is a line the feed holds

  # BL-834 host-page-watching-never-steers-06
  Scenario: the page offers no way to touch the running agent
    When the Host page is rendered for Bubble
    Then it exposes no affordance that stops, steers or interrupts the host agent
    And it references no bridge endpoint that mutates the host agent's session

  # BL-834 host-page-registered-07
  Scenario: the page is reachable from the pager
    When the served UI bundle manifest is read
    Then it names the Host page as one of its pages
