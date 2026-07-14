# mutation-stamp: sha256=a245caa7a53a37b8fca79b7a29ffe36bb4f862eadb093f406d0ec7a5a73443ef
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-14T01:20:52.997719290Z","feature_name":"A reply comes back in the thread the human asked in","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-355-reply-returns-to-asking-thread.feature","background_hash":"f61e8689aa5e73c612f95e21a806c997d9d5caeb0fe21b93177fb204dd0ccd6e","implementation_hash":"unknown","scenarios":[{"index":0,"name":"The reply is delivered to the thread the message came from","scenario_hash":"b1f6e66fa52bfeaaab4b7e4fb4446cc2fc398078155ad09a65e84b60a3b70ff8","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-14T01:20:52.997719290Z"}]}
# acceptance-mutation-manifest-end

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
