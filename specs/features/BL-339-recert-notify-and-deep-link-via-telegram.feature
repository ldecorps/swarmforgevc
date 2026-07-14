Feature: Telegram tells the human a recert batch is waiting, and takes him to it

# BL-339: the human asked whether he could give Gherkin recertification feedback via Telegram.
# Today he cannot — verdicts arrive only through the PWA and the inbound email path. He was asked
# which shape he wanted and chose notify + deep-link: Telegram announces the waiting batch and
# links into the PWA, where the batch UI already works. Verdicts are NOT given in Telegram. Recert
# is a batch activity and Telegram is a conversational surface; pushing the batch into a topic
# would either spam him or rebuild a form the PWA already does better.

Background:
  Given recertification verdicts are given in the PWA

# BL-339 recert-notify-deep-link-01
Scenario: A waiting recert batch is announced on Telegram
  Given a recert batch is waiting on the human
  When the human is notified
  Then a message about the waiting batch is sent to Telegram

# BL-339 recert-notify-deep-link-02
Scenario: The announcement links straight to the recert work in the PWA
  Given a recert batch is waiting on the human
  When the human is notified
  Then the message links to the recert work in the PWA
  And following the link lands on the recert work

# BL-339 recert-notify-deep-link-03
Scenario: A batch of many scenarios produces one message, not one per scenario
  Given a recert batch of many scenarios is waiting on the human
  When the human is notified
  Then one message is sent

# BL-339 recert-notify-deep-link-04
Scenario: An outstanding batch is not re-announced on every tick
  Given a recert batch is waiting on the human
  And the batch has already been announced
  When the human is notified again
  Then no message is sent

# BL-339 recert-notify-deep-link-05
Scenario: Nothing is announced when no recert batch is waiting
  Given no recert batch is waiting on the human
  When the human is notified
  Then no message is sent

# BL-339 recert-notify-deep-link-06
Scenario: A new batch after an answered one is announced again
  Given a recert batch has been announced and answered
  And a recert batch is waiting on the human
  When the human is notified
  Then a message about the waiting batch is sent to Telegram

# BL-339 recert-notify-deep-link-07
Scenario: A verdict is still not accepted through Telegram
  Given a recert batch is waiting on the human
  When the human replies to the announcement with a verdict
  Then the verdict is not recorded from Telegram
