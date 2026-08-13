# mutation-stamp: sha256=5fdf1ca0975ca2c617c89770799d5a1e0b7e0fc82df8c267b8fba537c5f52c3b
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-13T00:50:00.161557Z","feature_name":"Bubble Settings offers a Local or OpenAI voice engine and never lies about which one is in use","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-864-bubble-settings-voice-engine-selector.feature","background_hash":"48db5920e98ac5698c8a8006593733b2b462e356e0335cef1aa1fe4c49e4287e","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the selector opens on the engine the bridge is actually using","scenario_hash":"3c9d66b9b1bcfb44725af9be63a0e4cb9aaba536599c67924fcd9d19c48be30c","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-13T00:50:00.161557Z"}]}
# acceptance-mutation-manifest-end

Feature: Bubble Settings offers a Local or OpenAI voice engine and never lies about which one is in use

  # BL-864 (epic BL-862, slice B, depends on BL-863): the Bubble Settings dialog already owns
  # the talk preferences — hold music, mute, volume — and the human asked for the voice-engine
  # choice to live on that same surface: "put the selector in Bubble Settings". BL-863 gave the
  # bridge a durable preference, per-turn resolution, and a serviceability answer; this slice
  # is the phone-side control that writes it. Two things make this more than a toggle. The
  # phone must never hold or send `OPENAI_API_KEY` — it sends an engine NAME and the host
  # decides. And the human forbade a "silent fallback that looks like success": when the
  # bridge refuses a choice, Settings has to show the refusal reason and keep showing the
  # engine that is actually in use, not the one that was tapped.

  Background:
    Given Bubble is paired with a bridge
    And the voice-engine selector capability is enabled

  # BL-864 selector-shows-the-engine-in-use-01
  Scenario Outline: the selector opens on the engine the bridge is actually using
    Given the bridge reports "<engine>" as the engine in use
    When the Settings dialog is opened
    Then the voice-engine selector shows "<engine>" as selected

    Examples:
      | engine |
      | local  |
      | openai |

  # BL-864 choosing-an-engine-writes-it-to-the-bridge-02
  Scenario: choosing an engine sends the choice to the bridge
    Given the bridge reports "local" as the engine in use
    When "openai" is chosen in the Settings dialog
    Then the bridge is asked to store "openai"
    And no credential is included in what is sent

  # BL-864 refusal-shows-a-reason-and-does-not-stick-03
  Scenario: a refused choice shows the reason and leaves the working engine selected
    Given the bridge reports "local" as the engine in use
    And the bridge will refuse "openai" because the OpenAI key is missing
    When "openai" is chosen in the Settings dialog
    Then the refusal reason is shown
    And the voice-engine selector shows "local" as selected

  # BL-864 unserviceable-engine-is-offered-disabled-04
  Scenario: an engine the host cannot serve is offered disabled, with its reason
    Given the bridge reports "openai" as not serviceable because the OpenAI key is missing
    When the Settings dialog is opened
    Then "openai" is offered as disabled
    And the reason the OpenAI key is missing is shown

  # BL-864 choice-survives-relaunch-05
  Scenario: the chosen engine survives a Bubble relaunch
    Given "openai" was chosen and accepted
    When Bubble is relaunched
    Then the voice-engine selector shows "openai" as selected

  # BL-864 selector-hidden-when-capability-off-06
  Scenario: with the capability disabled the selector is absent
    Given the voice-engine selector capability is disabled
    When the Settings dialog is opened
    Then no voice-engine selector is shown
    And the other talk settings are still shown

  # BL-864 unreachable-bridge-does-not-fake-a-choice-07
  Scenario: with the bridge unreachable the selector does not report a change it could not make
    Given the bridge is unreachable
    When "openai" is chosen in the Settings dialog
    Then the failure to reach the bridge is shown
    And the voice-engine selector does not show "openai" as selected
