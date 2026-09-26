Feature: BL-1777 A swarm's coordinator messages and polls the human in its own topic

  Stamp-off of hotfix 6cef9b7ecd (BL-848). A newly onboarded swarm has no
  front desk, so its coordinator had no way to reach the human:
  gpu-bargain-hunter's coordinator sat blocked on a human-only decision
  with the request visible only in its tmux pane (2026-09-26). The hotfix
  ships notify_human.sh, which posts a message or a poll to the swarm's
  Coordinator topic, and human_replies.sh, which reads the principal's
  replies and poll votes there. Both take the bot credentials from the
  swarm's own fleet file, never from the environment, and human_replies.sh
  refuses while the swarm's front desk runs.

  Every scenario runs the real scripts from a fixture swarm root against a
  fake Bot API and a fixture fleet home, never a real bot.

  Background:
    Given a fixture swarm named "second" whose Coordinator topic is 42
    And its fleet creds file holds token "fleet-token" and chat "-1002"
    And the environment carries TELEGRAM_BOT_TOKEN "env-token" and principal user 7
    And a fake Bot API

  # BL-1777 a-message-reaches-the-coordinator-topic-with-the-fleet-token-01
  Scenario: a message goes to the Coordinator topic of the swarm's own chat with its own token
    When notify_human.sh sends "blocked on a human-only land"
    Then the fake Bot API received sendMessage for token "fleet-token", chat "-1002" and topic 42
    And it never received a call for token "env-token"

  # BL-1777 a-poll-vote-reads-back-as-the-chosen-option-02
  Scenario: a poll the coordinator sends reads back as the option the principal chose
    Given notify_human.sh sent the poll "Which fix?" with options "keep" and "retire"
    And the fake Bot API holds user 7's vote for option 2 of that poll
    When human_replies.sh reads the topic
    Then it prints "POLL ANSWER: Which fix? -> retire"

  # BL-1777 only-the-principal-in-the-coordinator-topic-is-printed-03
  Scenario Outline: human_replies.sh prints only the principal's messages in the Coordinator topic
    Given the fake Bot API holds a message "<text>" from user <user> in topic <topic>
    When human_replies.sh reads the topic
    Then it prints <printed>

    Examples:
      | text      | user | topic | printed            |
      | go ahead  | 7    | 42    | "go ahead"         |
      | elsewhere | 7    | 9     | "no new replies"   |
      | stranger  | 8    | 42    | "no new replies"   |

  # BL-1777 peek-leaves-the-mail-unread-04
  Scenario: a peek reads the replies without marking them read
    Given the fake Bot API holds a message "go ahead" from user 7 in topic 42
    When human_replies.sh reads the topic with --peek and then reads it again
    Then both reads print "go ahead"

  # BL-1777 refuses-while-a-front-desk-runs-05
  Scenario: human_replies.sh refuses while the swarm's front desk runs
    Given the swarm's front-desk supervisor pid file names a live process
    When human_replies.sh reads the topic
    Then it exits 3 naming the front desk
    And the fake Bot API was never called
