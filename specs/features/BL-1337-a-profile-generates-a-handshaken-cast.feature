# mutation-stamp: sha256=975c24b1499696ac4ef5fbf6b324495642a6432dac8fd8fc20a610c0de184ce3
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-03T06:32:47.410109019Z","feature_name":"BL-1337 a named profile generates a cast, and no seat is runnable unhandshaken","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1337-a-profile-generates-a-handshaken-cast.feature","background_hash":"05f7604165945dfd2b580084fbbe6a3476023dd1b80636d72ac525151e2482f7","implementation_hash":"unknown","scenarios":[{"index":1,"name":"a pick that fails its handshake never reaches the cast","scenario_hash":"4c1d54318b19239b0370a7c710eb2efa773f1a51026fb207c10fef05a565144d","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-09-03T06:32:47.410109019Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1337 a named profile generates a cast, and no seat is runnable unhandshaken

  BL-1181 already ships the generator half: `bob_starting_cast_lib.bb` cherry-
  picks a role entry from the steward registry, exports a cast JSON, converts
  it to a ModelFactory assignment overlay and applies it. A live cast sits at
  `.swarmforge/model-steward/casts/bob-multi-provider-20260831.json`.

  Two things are missing. The policy is hard-coded - the entry point is
  literally `export-bob-starting-cast`, and the live cast's own note says
  "Diversified across live providers with keys on host 2026-08-31; not pure
  steward top-pick", i.e. a human adjusted it by hand. And nothing handshakes:
  the apply path will happily install a cast naming a model that is
  registered but dead on this host's keys.

  This slice makes the policy a named profile and puts a handshake in front of
  "runnable". A cast is proposed, never silently installed.

  Background:
    Given a steward registry with role rankings and certification status
    And a named profile stating its topology, quality floor and provider rules

  # BL-1337 fully-handshaken-cast-is-runnable-01
  Scenario: a profile whose every pick handshakes yields a runnable cast
    Given every seat the profile asks for has an eligible model reachable on this host
    When the cast is generated from that profile
    Then the cast is offered as runnable
    And an evidence note records the profile and each seat's handshake result

  # BL-1337 handshake-outcome-decides-the-seat-02
  Scenario Outline: a pick that fails its handshake never reaches the cast
    Given a seat whose best-ranked model <condition>
    When the cast is generated from that profile
    Then that seat is staffed by <outcome>

    Examples:
      | condition                                   | outcome                            |
      | is eligible and reachable                   | that model                         |
      | is not assignment-eligible for that role    | the next model that handshakes     |
      | is eligible but unreachable on this host    | the next model that handshakes     |

  # BL-1337 unstaffable-seat-fails-loud-03
  # Never emit a cast that lies about availability.
  Scenario: a seat with no model above the floor fails the whole cast loudly
    Given a seat for which no eligible model reaches the profile's quality floor
    When the cast is generated from that profile
    Then the cast is not offered as runnable
    And the failure names that seat

  # BL-1337 propose-never-install-04
  Scenario: generating a cast does not change the live swarm
    Given a live pack is configured
    When the cast is generated from that profile
    Then the live pack configuration is unchanged

  # BL-1337 no-secret-material-in-output-05
  Scenario: nothing the generator writes carries secret material
    When the cast is generated from that profile
    Then no file it wrote contains credential material
