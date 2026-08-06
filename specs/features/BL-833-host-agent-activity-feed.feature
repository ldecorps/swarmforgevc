Feature: the bridge serves the host agent's activity so something other than Telegram can watch a turn

  The host agent already summarizes its SDK events into progress lines, and those
  lines already reach the operator's Telegram topic. Nothing persists them and no
  second consumer can attach. This ticket tees them into a bounded per-session
  feed the bridge serves, so a phone screen can watch a turn happen instead of
  waiting for the reply.

  Everything here is TypeScript on the bridge and the host tools and runs in the
  Node acceptance runner.

  Background:
    Given a running swarm and the bridge started via its opt-in command

  # BL-833 host-feed-records-during-turn-01
  Scenario: activity is readable while the turn is still running
    Given a host agent turn is in progress and has emitted progress lines
    When an authenticated client reads the host activity feed
    Then it receives those lines before the turn's reply is produced

  # BL-833 host-feed-only-emitted-lines-02
  Scenario: the feed invents nothing
    Given a host agent turn has emitted a known set of progress lines
    When an authenticated client reads the host activity feed
    Then every line it receives came from a host event
    And no line was synthesized from the turn's outcome

  # BL-833 host-feed-live-push-03
  Scenario: an attached client is pushed new lines without polling
    Given an authenticated client attached to the bridge event stream
    When the host agent emits a further progress line
    Then that line is pushed to the attached client

  # BL-833 host-feed-catchup-matches-stream-04
  Scenario: catching up late gives the same record as watching throughout
    Given a host agent turn is in progress and has emitted progress lines
    When a client that attached late reads the buffered feed
    Then it receives the same lines a client attached throughout received

  # BL-833 host-feed-bounded-05
  Scenario: a long session does not grow the feed without limit
    Given a host agent session has emitted more lines than the feed's bound
    When an authenticated client reads the host activity feed
    Then the feed holds at most its bound
    And the oldest lines were evicted first

  # BL-833 host-feed-quiet-state-06
  Scenario: a quiet host reads as quiet, not as a fault
    Given no host agent session is active
    When an authenticated client reads the host activity feed
    Then the feed reports the host as quiet
    And it does not report a failure

  # BL-833 host-feed-never-damages-the-turn-07
  Scenario: a broken feed does not break the turn it observes
    Given the feed's write path fails for every line
    When a host agent turn runs
    Then the turn completes and produces its reply

  # BL-833 host-feed-unauthenticated-refused-08
  Scenario: an unauthenticated client cannot read the feed
    Given a client without valid authentication
    When it requests the host activity feed
    Then the request is refused
