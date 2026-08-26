Feature: Onboarding provisions the target repo's own Telegram channel

# BL-380: the negotiation loop does not touch Telegram at all today — BL-344's rounds are
# file/CLI-based. This ticket gives each onboarded target its OWN bot and its OWN forum group, so
# the contract can later be negotiated there (BL-381). Two things CANNOT be automated: the
# Telegram Bot API has no create-bot method (BotFather only) and no create-group / enable-topics
# method. So onboarding automates everything either side of one guided human step, and detects
# completion rather than asking the human to paste a chat id. Per-target BOTS are what make the
# isolation structural: two swarms cannot share one bot token (Telegram answers a second
# concurrent poller with 409 Conflict, and the confirm-offset is per-token, so a shared token
# silently destroys one project's messages).

Background:
  Given a target repo is being onboarded

# BL-380 onboarding-provisions-the-targets-channel-01
Scenario: Onboarding tells the human exactly how to create the channel
  When onboarding provisions the target's channel
  Then the human is given the steps to create the target's own bot and group
  And the human is given a link that adds that bot to a group

# BL-380 onboarding-provisions-the-targets-channel-02
Scenario: The new group is detected, not typed in
  Given the human has created the target's group and added its bot
  When onboarding provisions the target's channel
  Then the group is remembered against the target repo
  And the human is never asked to paste the group's identifier

# BL-380 onboarding-provisions-the-targets-channel-03
Scenario: The contract's negotiation topic is opened in the new group
  Given the human has created the target's group and added its bot
  When onboarding provisions the target's channel
  Then a contract negotiation topic is opened in the target's group

# BL-380 onboarding-provisions-the-targets-channel-04
Scenario: A half-finished channel is reported, never treated as ready
  Given the human has not finished creating the target's group
  When onboarding provisions the target's channel
  Then the channel is reported as not ready
  And no contract negotiation topic is opened

# BL-380 onboarding-provisions-the-targets-channel-05
Scenario: A second target is provisioned with its own bot
  Given another target repo has already been onboarded with its own bot
  When onboarding provisions the target's channel
  Then the target is given a bot of its own
  And the other target's bot is left untouched
