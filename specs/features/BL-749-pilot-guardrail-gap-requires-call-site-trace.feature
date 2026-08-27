Feature: Review hats and /pilot never dismiss a ticket guardrail gap without call-site tracing

  # BL-749: BL-623's cleaner/coder noted log-routing-skip! had no try/catch
  # despite the ticket's own "record-write failure must not block the send"
  # guardrail, but judged it a non-blocking nit. The hardener traced the
  # -main call site and found it blocks try-sync-deliver! (BL-748). This
  # ticket makes that call-site trace mandatory in review-role guidance
  # (specifier-landed) and in composePilotExpeditorPrompt (/pilot).

  Background:
    Given the pilot expeditor prompt composer is available

  # BL-749 guardrail-trace-01
  Scenario: cleaner and hardener role prompts require call-site tracing before nit-downgrade
    When the cleaner role prompt is read
    Then it requires call-site tracing before downgrading a ticket guardrail gap to a nit
    When the hardener role prompt is read
    Then it requires call-site tracing before downgrading a ticket guardrail gap to a nit

  # BL-749 guardrail-trace-02
  Scenario: the /pilot prompt requires the same call-site tracing rule for review hats
    When the offline expeditor prompt is composed for ticket "BL-749"
    Then the prompt requires call-site tracing before downgrading a ticket guardrail gap to a nit

  # BL-749 guardrail-trace-03
  Scenario: the rule names reading the call site not only the function in isolation
    When the offline expeditor prompt is composed for ticket "BL-749"
    Then the prompt requires reading the call site not only the function in isolation
