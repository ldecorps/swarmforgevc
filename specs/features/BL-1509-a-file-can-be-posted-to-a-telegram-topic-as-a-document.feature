Feature: BL-1509 A file can be posted to a Telegram topic as a document attachment

  The Telegram client sends text, polls and voice notes, but has no
  sendDocument: nothing in the swarm can hand the operator a FILE. The
  operator asked for the model-scoring table as a properly formatted
  attachment in the Concierge topic (BL-1510), and named sendVoiceNote -
  the one multipart upload the client already does - as the pattern to
  extend rather than invent beside. This feature is that upload, plus a
  headless CLI that posts any file to the standing Concierge topic, the
  same way notify-dead-letters posts a line there.

  # BL-1509 file-posted-as-telegram-document-01
  Scenario: a document upload is a multipart sendDocument carrying chat, thread and filename
    Given a bot token, a chat id and a topic id
    When a file named report.md is sent as a document to that topic
    Then the client posts one multipart request to the sendDocument endpoint
    And the form carries the chat id, the topic id as message_thread_id, and the file under its own name

  # BL-1509 file-posted-as-telegram-document-02
  Scenario Outline: a failed upload reports the server's reason with the token redacted
    Given the Bot API answers <answer>
    When a file is sent as a document
    Then the result is not a success
    And its error carries <reason> and never the token

    Examples:
      | answer                                       | reason                  |
      | HTTP 400 with description "chat not found"   | the description text    |
      | a network failure before any response        | the failure message     |

  # BL-1509 file-posted-as-telegram-document-03
  Scenario Outline: the headless CLI posts a file to the standing Concierge topic or says why it cannot
    Given a project root whose topic map <map state>
    And the front desk's credentials exported as TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
    When the send-document CLI runs with a file path
    Then <outcome>

    Examples:
      | map state                          | outcome                                                             |
      | names the Concierge topic          | the file is sent to that topic and the CLI exits 0                 |
      | has no Concierge topic yet         | the CLI exits non-zero naming operator-topic-not-yet-created        |
