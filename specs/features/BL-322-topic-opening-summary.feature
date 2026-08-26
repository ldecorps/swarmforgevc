Feature: A new BL topic opens with a short summary instead of a bare TaskStarted

# BL-322: diffTaskStarted mints its event with an empty payload
# (extension/src/events/swarmEventStream.ts:50), so a new Telegram topic opens with
# only "TaskStarted: BL-XXX" — no information the topic title does not already carry.
# The payload is derived from the ticket YAML that already exists on disk: title,
# the first paragraph of notes, and the first acceptance step.

Background:
  Given the front desk opens a Telegram topic for each newly-active backlog ticket

# BL-322 topic-opening-summary-01
Scenario: A newly-active ticket opens its topic with a what/solves/how summary
  Given an active ticket with a title, a notes block, and acceptance steps
  When its topic is opened
  Then the opening message states what it is, what it solves, and how it works
  And the opening message is not a bare "TaskStarted" line

# BL-322 topic-opening-summary-02
Scenario Outline: A ticket missing a summary source still opens cleanly
  Given an active ticket whose <missing_field> is absent
  When its topic is opened
  Then the opening message is non-empty and well-formed
  And it falls back to the ticket title

  Examples:
    | missing_field    |
    | notes            |
    | acceptance steps |

# BL-322 topic-opening-summary-03
Scenario: An oversized notes block is truncated to a safe message length
  Given an active ticket whose notes block is far longer than a Telegram message allows
  When its topic is opened
  Then the opening message is truncated
  And the opening message is within the Telegram message length limit

# BL-322 topic-opening-summary-04
Scenario Outline: Other event types are unchanged
  Given a ticket that emits a <event_type> event
  When that event is rendered
  Then its message is unchanged from before this feature

  Examples:
    | event_type    |
    | TaskCompleted |
    | NeedsApproval |
