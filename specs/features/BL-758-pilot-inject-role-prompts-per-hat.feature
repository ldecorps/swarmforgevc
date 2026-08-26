Feature: /pilot injects each live role prompt at hat change with durable stage evidence

  # BL-758: Today's composePilotExpeditorPrompt mega-brief says "wear every
  # hat" without loading swarmforge/roles/<role>.prompt (or pack overlays).
  # BL-723 showed that shape skips gates a real role prompt would treat as
  # mandatory. Spec: thin pilot wrapper + per-hat reinject of the same role
  # prompt files the live swarm uses; stage verdicts record path + content
  # hash; land gate refuses missing evidence.

  Background:
    Given the pilot expeditor prompt composer is available

  # BL-758 per-hat-01
  Scenario: composing a stage hat prompt includes the live role prompt file contents
    When a pilot stage prompt is composed for ticket "BL-758" and role "coder"
    Then the composed prompt includes the contents of swarmforge/roles/coder.prompt
    And the composed prompt still carries the thin pilot isolation wrapper

  # BL-758 per-hat-02
  Scenario: the /pilot start path no longer replaces role duties with a mega-brief alone
    When the offline expeditor prompt is composed for ticket "BL-758"
    Then the prompt requires injecting each role's real prompt at hat change
    And the prompt does not instruct wearing every pipeline hat from one mega-brief alone

  # BL-758 per-hat-03
  Scenario: a completed stage verdict without role-prompt evidence refuses the land
    Given the run has a completed stage verdict for role "coder"
    And that verdict omits role_prompt_path or role_prompt_sha256
    When the pilot runs the landing gate
    Then the land is refused for missing per-hat role prompt evidence
    And the refusal names the role or verdict path

  # BL-758 per-hat-04
  Scenario: every completed stage verdict with matching prompt path and hash lets the land complete
    Given every completed stage verdict records role_prompt_path for that role under swarmforge/roles/
    And each records a non-empty role_prompt_sha256 of the prompt bytes active for that stage
    When the pilot runs the landing gate
    Then the land is completed

  # BL-758 per-hat-05
  Scenario: a refused per-hat-prompt land writes nothing durable
    Given a completed stage verdict lacks role_prompt_path or role_prompt_sha256
    When the pilot runs the landing gate
    Then the land is refused for missing per-hat role prompt evidence
    And the ticket yaml stays where it was
    And no acceptance receipt is written

  # BL-758 per-hat-06
  Scenario: bounce-back to an earlier role reinjects that role's prompt
    Given the pilot has bounced back to role "specifier"
    When the next stage prompt is composed for that bounce-back
    Then the composed prompt includes the contents of swarmforge/roles/specifier.prompt
