Feature: The front desk only listens to its own project's chat

# BL-379: the inbound path filters on the SENDER and nothing else. `decideUpdateAction`
# (extension/src/tools/telegramFrontDeskBotCore.ts) calls `isFromPrincipal` and then, for any
# unmapped topic, AUTO-ADOPTS the message into a fresh SUP-### (BL-294). It never consults the
# chat the message came from — even though `update.message.chat` is already parsed and typed
# (telegramClient.ts:137). Today one group exists, so nothing misroutes; the moment a second
# project's group exists on the same bot, project A's front desk would ingest project B's
# messages. Same loss class as BL-369/370/371. Per-project bots (BL-380) make the isolation
# structural, but a bot can still be added to a stray group, so this guard is the floor.
#
# Row 3 of scenario 01 is the priority-order pin: BOTH drop conditions hold at once (a stranger,
# in a foreign chat), and it asserts the FOREIGN-CHAT reason wins. Testing each condition alone
# would leave the order of the two guards entirely unproven and let a clause-swap mutant survive.

Background:
  Given the front desk is bound to its own project's chat

# BL-379 front-desk-listens-only-to-its-own-chat-01
Scenario Outline: The front desk takes work only from its own chat
  Given a message from <sender> in <chat> chat
  When the front desk collects the waiting messages
  Then the message is <outcome>

  Examples:
    | sender     | chat    | outcome            |
    | the human  | its own | taken as work      |
    | the human  | another | refused as foreign |
    | a stranger | another | refused as foreign |

# BL-379 front-desk-listens-only-to-its-own-chat-02
Scenario: A refused message never opens a support thread
  Given a message from the human in another chat
  When the front desk collects the waiting messages
  Then no support thread is opened for it

# BL-379 front-desk-listens-only-to-its-own-chat-03
Scenario: An unmapped topic in the front desk's own chat still opens a support thread
  Given a message from the human in an unmapped topic of its own chat
  When the front desk collects the waiting messages
  Then a support thread is opened for it
