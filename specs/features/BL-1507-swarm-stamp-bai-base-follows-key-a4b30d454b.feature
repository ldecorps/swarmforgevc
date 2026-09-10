Feature: BL-1507 Stamp-off review of the b.ai base-follows-key hotfix

  BL-848 review-only certification of landed commit a4b30d454b (2026-09-09).
  The launcher's opt-in b.ai guard (emitted when SWARMFORGE_USE_BAI=1 is
  honoured and the window's CLI does not name api.b.ai) exported the b.ai
  key but kept any OPENAI_API_BASE already in the environment. A pane
  respawned by swarm ensure from a shell still carrying a stale Cerebras
  opt-in therefore presented the b.ai key to api.cerebras.ai and aider
  failed every turn with "Wrong API Key". The hotfix makes the opt-in
  guard set the b.ai base unconditionally, as the host-sniff variant
  already did.

  These scenarios confirm or refute what landed; none may rewrite it, and
  none writes a certify or waive decision into backlog/hotfix-ledger.yaml -
  only a recorded human decision does that.

  # BL-1507 swarm-stamp-bai-base-follows-key-01
  Scenario Outline: the emitted guard blocks yield the base the flag means, whatever base the environment carries
    Given a launch script generated for an aider window <cli shape> with SWARMFORGE_USE_BAI <flag>
    When its guard blocks are executed with a stale Cerebras base already exported
    Then OPENAI_API_KEY is <key>
    And OPENAI_API_BASE and OPENAI_BASE_URL are <base>

    Examples:
      | cli shape                        | flag     | key         | base                |
      | whose CLI does not name api.b.ai | honoured | the b.ai key | https://api.b.ai/v1 |
      | whose CLI names api.b.ai         | honoured | the b.ai key | https://api.b.ai/v1 |
      | whose CLI does not name api.b.ai | unset    | unchanged   | the Cerebras base   |

  # BL-1507 swarm-stamp-bai-base-follows-key-02
  Scenario: the key never reaches the launch script file
    Given a launch script generated with SWARMFORGE_USE_BAI=1 honoured and a known B_AI_API_KEY value
    When the launch script file is read
    Then the key value does not appear in it

  # BL-1507 swarm-stamp-bai-base-follows-key-03
  Scenario: the stamp leaves the certification decision to the human
    When the review parcel completes
    Then the ledger row for the reviewed commit still reads "pending"
