# mutation-stamp: sha256=a06ce1cee317ccf1988f63978717da95a7fc929450827172b5fc4e19199acbb2
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-12T21:56:56.020907Z","feature_name":"the bridge honors a stored voice-engine preference and refuses an unusable engine loudly","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-863-voice-engine-preference-bridge.feature","background_hash":"2b964c8c57bc7d0d2a5f00bbe8206af21f244ae0167855df9bc6675459387df2","implementation_hash":"unknown","scenarios":[{"index":3,"name":"selecting an engine the host cannot serve fails with a usable reason","scenario_hash":"651d6e283e54b392a15f05e91d9ee62cb05652ed4721b7bef91d6290d47f9939","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-12T21:56:56.020907Z"},{"index":4,"name":"the bridge can be asked whether an engine is serviceable before it is chosen","scenario_hash":"273e5735f29299dad6e31eff742f0caefce212bb11347cd6bae9dafbb61c03fd","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-12T21:55:10.329253Z"}]}
# acceptance-mutation-manifest-end

Feature: the bridge honors a stored voice-engine preference and refuses an unusable engine loudly

  # BL-863 (epic BL-862, from the 2026-08-08 human intake): Let's Talk picks its STT/TTS
  # adapters from `LETS_TALK_AUDIO_ENGINE` in the bridge host environment, so changing voice
  # means editing a shell profile and bouncing the bridge. This slice makes the choice a
  # durable preference the phone can later set, resolved per turn so a change applies to the
  # next turn without a restart. It also fixes a failure mode the human explicitly forbade:
  # today both branches of `resolveLetsTalkAudioAdapters` end in `?? {}`, so selecting OpenAI
  # with no `OPENAI_API_KEY` on the host — or Local with no local engine — silently yields an
  # empty adapter set that looks like success. Locked human decision 4: "if missing,
  # selecting OpenAI must fail loudly with a usable reason (not silent fallback that looks
  # like success)". The key itself never leaves the host: the preference carries an engine
  # NAME only, never a credential.

  Background:
    Given a bridge host with a Let's Talk voice-engine preference store

  # BL-863 stored-preference-wins-over-env-01
  Scenario: a stored preference decides the engine
    Given the host environment bootstraps the engine as "local"
    And the stored preference selects "openai"
    And the host has an OpenAI key
    When adapters are resolved for a turn
    Then the "openai" engine is used

  # BL-863 env-is-the-bootstrap-default-02
  Scenario: with no preference stored the host environment still decides
    Given no preference has been stored
    And the host environment bootstraps the engine as "openai"
    And the host has an OpenAI key
    When adapters are resolved for a turn
    Then the "openai" engine is used

  # BL-863 change-applies-next-turn-without-restart-03
  Scenario: a preference written between turns applies to the next turn
    Given the stored preference selects "local"
    And a turn has already been resolved
    When the stored preference is changed to "openai"
    And adapters are resolved for a turn
    Then the "openai" engine is used
    And the bridge was not restarted

  # BL-863 unusable-engine-fails-loudly-04
  Scenario Outline: selecting an engine the host cannot serve fails with a usable reason
    Given the stored preference selects "<engine>"
    And the host <host_state>
    When adapters are resolved for a turn
    Then resolution fails with a reason naming "<engine>"
    And the reason states <missing_thing> is missing
    And no empty adapter set is returned

    Examples:
      | engine | host_state                | missing_thing   |
      | openai | has no OpenAI key         | the OpenAI key  |
      | local  | has no local speech engine| the local engine|

  # BL-863 usable-engine-reports-serviceable-05
  Scenario Outline: the bridge can be asked whether an engine is serviceable before it is chosen
    Given the host <host_state>
    When the serviceability of "<engine>" is requested
    Then "<engine>" is reported <verdict>

    Examples:
      | engine | host_state          | verdict          |
      | openai | has an OpenAI key   | serviceable      |
      | openai | has no OpenAI key   | not serviceable  |

  # BL-863 preference-never-carries-a-credential-06
  Scenario: storing a preference that carries a credential is refused
    When a preference carrying an OpenAI key is stored
    Then the store refuses it
    And the stored preference is unchanged

  # BL-863 unreadable-preference-degrades-to-the-bootstrap-07
  Scenario: an unreadable preference falls back to the host environment, not to nothing
    Given the stored preference is unreadable
    And the host environment bootstraps the engine as "local"
    When adapters are resolved for a turn
    Then the "local" engine is used
    And the unreadable preference is reported
