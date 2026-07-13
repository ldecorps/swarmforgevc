Feature: A reply comes back in the thread the human asked in

# BL-355: the human asked in the group's General topic five times in one day and saw total silence,
# concluding each time that the swarm was dead. It was not — every message was received, processed
# and answered, but a message with no thread id resolves to the DEFAULT support subject, and the
# reply relay routes the answer to the topic mapped to that subject. Question in General, answer in
# SUP. From the human's chair an answered question is indistinguishable from a dead swarm unless the
# answer lands where he is looking.

Background:
  Given the human sends a message in a thread

# BL-355 reply-returns-to-asking-thread-01
Scenario Outline: The reply is delivered to the thread the message came from
  Given the message was posted in "<asking-thread>"
  When the swarm replies to it
  Then the reply appears in "<asking-thread>"

  Examples:
    | asking-thread          |
    | the General topic      |
    | a support topic        |
    | a backlog item's topic |

# BL-355 reply-returns-to-asking-thread-02
Scenario: An answer delivered elsewhere still leaves a pointer in the asking thread
  Given the reply for the message can only be delivered in another thread
  When the swarm replies to it
  Then the asking thread carries a pointer saying where the answer was delivered

# BL-355 reply-returns-to-asking-thread-03
Scenario: Every inbound human message gets a visible response in its own thread
  When the swarm replies to it
  Then some visible response appears in the thread the human posted in
