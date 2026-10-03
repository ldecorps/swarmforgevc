Feature: The local seat answers from what it reads in the repo

  The human, from the Host topic on 2026-10-03: "What I want is a all
  rounder chat, equivalent to what Cursor does in the Host topic". The
  local seat sends one completion with the project briefing as its system
  prompt and no read path, so asked "can you see the swarmforgevc repo?" it
  said, correctly, that it cannot. A briefing that claimed sight without a
  read path would invent status. The seat now reads the repository for
  each turn, read-only, and the model sees what was read. It never sees a
  secret. Cursor keeps the Host topic and the front desk.

  Background:
    Given a local seat fixture over a scratch git repository whose model endpoint is faked and records every request

  # BL-1911 a-ticket-question-carries-the-ticket-01
  Scenario: a question about a ticket reaches the model with that ticket's text
    Given the scratch repository's backlog/active/ holds BL-9001 titled "the bridge restarts on a stale build"
    When the operator asks the seat "what is BL-9001 about?"
    Then some request the seat sends to the model carries "the bridge restarts on a stale build"

  # BL-1911 a-secret-never-reaches-the-model-02
  Scenario Outline: a secret file never reaches the model
    Given the scratch repository holds "<file>" containing "SECRET-TOKEN-1911"
    When the operator asks the seat "show me <file>"
    Then no request the seat sends to the model carries "SECRET-TOKEN-1911"

    Examples:
      | file                               |
      | .swarmforge/operator/bridge-token  |
      | .swarmforge/swarm.env              |
      | extension/.env                     |

  # BL-1911 a-failed-read-still-answers-03
  Scenario: a turn whose repository read fails still answers and says so
    Given the seat's repository root cannot be read
    When the operator asks the seat "what is BL-9001 about?"
    Then the seat's reply is posted in its topic
    And the request the seat sends to the model says the repository could not be read

  # BL-1911 the-seat-keeps-only-its-topic-04
  Scenario: the seat still takes turns only in its own topic
    When a message arrives in the Host topic
    Then the local seat does not take the turn
