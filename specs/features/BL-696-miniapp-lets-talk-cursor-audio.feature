Feature: Let's Talk — discrete audio turns with the Cursor agent on the Console Mini App

  # Human-requested 2026-07-27. Child of epic swarmforge-console / BL-517.
  # Rides the same Mini App bridge host as BL-526, BL-538, and GH-23.
  #
  # HOST: extension/src/bridge/bridgeServer.ts — pre-auth shell /lets-talk
  # plus token-gated JSON routes. Fifth button on the /console menu.
  #
  # INTERACTION: tap-to-toggle record → STT (server-side) → existing Cursor
  # bridge agent session → TTS (server-side) → playback. No duplex live.
  #
  # SESSION: shared agentId with the Telegram Cursor Remote text topic by
  # default; POST /lets-talk/new-session clears context like /new.

  Background:
    Given the SwarmForge bridge Mini App is reachable with my allowlisted console token
    And the console menu at /console is available
    And the Cursor bridge agent session is available

  # BL-696 lets-talk-01
  Scenario: opening Let's Talk from the console menu shows the audio turn screen
    When I open Let's Talk from the console menu
    Then the page shows a tap-to-toggle record control
    And shows conversation state "ready"
    And shows a New session control

  # BL-696 lets-talk-02
  Scenario: a spoken turn is transcribed, answered by the Cursor agent, and played back with transcript
    Given I am on the Let's Talk screen
    When I record a short spoken question and end the turn
    Then conversation state becomes "thinking" then "speaking"
    And the page shows a text transcript of the agent reply
    And I hear the synthesized reply audio for that transcript
    And conversation state returns to "ready"

  # BL-696 lets-talk-03
  Scenario: a second spoken turn in the same session keeps Cursor agent context
    Given I completed one Let's Talk turn asking "remember the code word ALPHA"
    When I record a second turn asking "what was the code word"
    Then the agent reply transcript mentions "ALPHA"
    And the reply uses the same Cursor bridge agent session as the first turn

  # BL-696 lets-talk-04
  Scenario: New session clears context for the next turn
    Given I completed one Let's Talk turn asking "remember the code word BETA"
    When I tap New session
    And I record a turn asking "what was the code word"
    Then the agent reply transcript does not mention "BETA"

  # BL-696 lets-talk-05
  Scenario: a missing or wrong console token cannot reach the audio turn route
    Given I am on the Let's Talk screen without a valid console token
    When I attempt to submit a recorded turn
    Then the request is rejected with unauthorized
    And no speech-to-text or Cursor agent call is made

  # BL-696 lets-talk-06
  Scenario: a transient speech-to-text failure is recoverable and does not wedge the session
    Given I am on the Let's Talk screen
    And speech-to-text fails transiently once then succeeds
    When I record a short spoken question and end the turn
    Then the page shows conversation state "error" only while retrying
    And the turn eventually completes with a spoken reply
    And conversation state returns to "ready"

  # BL-696 lets-talk-07
  Scenario: structurally bad audio surfaces a recoverable error
    Given I am on the Let's Talk screen
    When I submit a recording with no decodable audio
    Then the page shows a recoverable error explaining the audio could not be transcribed
    And conversation state returns to "ready"
    And no Cursor agent prompt is sent

  # BL-696 lets-talk-08
  Scenario: the Telegram Cursor Remote text topic continues to work unchanged
    Given the Cursor bridge agent session has context from a Let's Talk turn
    When the principal sends a text prompt on the Cursor Remote Telegram topic
    Then the text prompt is delivered to the same agent session
    And the Telegram reply reflects the shared context
