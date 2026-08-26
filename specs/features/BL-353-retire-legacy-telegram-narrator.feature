Feature: One Telegram system, with no signal lost on the way to it

# BL-353 (BL-336 findings H2/H3): there are TWO Telegram systems. The Concierge front desk runs
# headless and is the live one. The older single-chat narrator and its inbound relay only run
# inside the VS Code extension host, and have not fired at all today. The human's decision
# (2026-07-13) is to RETIRE the legacy pair - but only after porting any signal the Concierge does
# not already carry, so retiring it cannot silently delete an alert. Retiring first and checking
# later is the exact failure this audit exists to prevent.

Background:
  Given a swarm running headless, with no editor attached

# BL-353 retire-legacy-telegram-narrator-01
Scenario: Every signal the legacy narrator sent still reaches the human
  Given a signal the legacy narrator used to send
  When that signal occurs
  Then the human is still told about it

# BL-353 retire-legacy-telegram-narrator-02
Scenario: A signal the surviving system did not already carry is carried now
  Given a signal the legacy narrator sent that the front desk did not
  When that signal occurs
  Then the front desk tells the human about it

# BL-353 retire-legacy-telegram-narrator-03
Scenario: The human's answer to a blocking question still reaches the role that asked
  Given a role is blocked on a question to the human
  When the human answers it from Telegram
  Then the role that asked receives the answer

# BL-353 retire-legacy-telegram-narrator-04
Scenario: The retired system no longer runs
  When the swarm runs
  Then the legacy narrator does not send anything
  And the legacy inbound relay does not receive anything

# BL-353 retire-legacy-telegram-narrator-05
Scenario: The human is not told the same thing twice
  Given a signal that both systems could have sent
  When that signal occurs
  Then the human is told about it once
