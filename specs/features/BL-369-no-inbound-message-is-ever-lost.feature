Feature: A message the human sends is never silently lost

# BL-369: on 2026-07-13 the human asked "Why is the operator not staying up in attended mode when
# asked to do so?" in SUP-2. It reached the thread transcript (message 46) and then reached NOBODY:
# no event on either operator queue, no Operator ever woken, ~9h of silence on a direct question.
# Inbound only recovered when the bot and bridge were restarted by hand at 02:40 the next morning.
# Throughout, the supervisor reported status:running / attempts:1 — a live process is not proof the
# consumer is consuming.
#
# THE PATH HAS FOUR INDEPENDENT SINGLE-POINTS-OF-LOSS, all verified in code, any one of which drops
# the message with no trace:
#   1. pollAndForward (telegramFrontDeskBotCore.ts) computes the next Telegram offset from the
#      updates it FETCHED, not the ones it DELIVERED. The offset advances even when delivery failed
#      (the failures are counted into `dropped` and thrown away). Once that offset moves, Telegram
#      will never redeliver — which is what makes every loss below PERMANENT rather than merely late.
#   2. postToBridge returns a boolean that its caller discards.
#   3. handleTelegramInboundRoute (bridgeServer.ts:296-297) writes the thread transcript FIRST and
#      enqueues the operator event SECOND, as two non-atomic steps, with no .catch on the promise
#      chain. A failure between them leaves exactly the observed signature: the transcript keeps the
#      message, the queue never gets it, and nothing reconciles the two.
#   4. The pending queue has two writers in two OS processes with no lock: the bridge (Node) APPENDS,
#      while operator_runtime.bb does four unsynchronized read-modify-writes of the whole file every
#      tick (:324, :483 bl-topic-approval-sweep!, :775 launch-operator! which DELETES it, :850
#      launch-front-desk-operator! which rewrites it with `remaining`). Any event appended between a
#      read and its rewrite is destroyed.
#
# THE INVARIANT THIS TICKET BUYS: a message the human sends is either durably queued for an Operator,
# or it is redelivered until it is — and if it can never be, the human is TOLD. It is never silently
# dropped. Note that BL-345's starvation alarm was structurally incapable of catching this: it fires
# on events PENDING too long, and this event never existed to be pending.

Background:
  Given the human is talking to the Operator in a Telegram topic

# BL-369 no-inbound-message-is-ever-lost-01
Scenario: A message arriving while the queue is being claimed is still owned
  Given the operator runtime is claiming events from its pending queue
  When a message from the human arrives at that moment
  Then an Operator is woken for that message

# BL-369 no-inbound-message-is-ever-lost-02
Scenario Outline: A message the front desk could not durably accept is redelivered, never skipped
  Given the front desk cannot durably accept an inbound message because <failure>
  When the human's message is sent
  Then the front desk does not treat that message as received
  And the message is delivered again once the failure clears
  And an Operator is woken for that message

  Examples:
    | failure                      |
    | the bridge cannot be reached |
    | the event cannot be queued   |

# BL-369 no-inbound-message-is-ever-lost-03
Scenario: A message delivered twice is only acted on once
  Given a message from the human was accepted but its acknowledgement was lost
  When the same message is delivered again
  Then it appears exactly once in the thread's transcript
  And exactly one Operator wake is queued for it

# BL-369 no-inbound-message-is-ever-lost-04
Scenario: A message recorded in a thread but never queued is reclaimed
  Given a message from the human is recorded in a thread's transcript
  And no Operator was ever woken for it
  When the front desk reconciles its threads against its queue
  Then an Operator is woken for that message

# BL-369 no-inbound-message-is-ever-lost-05
Scenario: A message that can never be accepted is surfaced to the human, never dropped
  Given the front desk cannot durably accept an inbound message because the bridge cannot be reached
  When it has retried up to its limit
  Then it stops retrying
  And the failure is escalated to the human
  And the front desk does not treat that message as received
