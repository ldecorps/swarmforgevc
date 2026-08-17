# mutation-stamp: sha256=7772344640f91cee55a10dc2adb479224f7bb311e50ee62221b3dc26f32311e4
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-17T16:53:34.220769Z","feature_name":"A rotating role boots on a prompt composed from the current sources, not the one built at launch","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-911-rotation-recomposes-the-role-prompt.feature","background_hash":"181552df05bfba7f53daa31e025bb69fbd182e4dd10b237fa84bdf6c9515b76a","implementation_hash":"unknown","scenarios":[{"index":0,"name":"prose landed after launch reaches the role at its next rotation","scenario_hash":"4b71efa1bb802e32f67b917dd29c55b12324d39f01710cd932c96d952533bf6f","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-17T16:53:34.220769Z"},{"index":1,"name":"whichever driver rotates the role, it boots on a freshly composed prompt","scenario_hash":"ad178a12d2bd95aec255cb27753ee4e073330248be2eb656c7f59c2b44ce57a1","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-17T16:53:34.220769Z"}]}
# acceptance-mutation-manifest-end

Feature: A rotating role boots on a prompt composed from the current sources, not the one built at launch

  # BL-911 (epic swarm-reliability): the composed prompt a role boots on
  # (.swarmforge/prompts/<role>.md) is a build output written only by the launch path.
  # Rotation re-execs the pre-generated launch script, which names that already-written
  # file, so nothing between two full launches ever recomposes it. On a mono-router pack
  # with continuous shifts there is no natural relaunch, so every rule proposal accepted
  # into a role prompt, and every constitution amendment inlined into the prefix, sits on
  # `main` in force for nobody. This slice makes rotation the moment freshness is
  # established. It is the inlined half of the delivery gap; BL-640 is the on-demand
  # `articles/reference/` half, read from each role's own worktree, and stays its own
  # ticket with its own mechanism.
  #
  # One step text per idea, deliberately: the rotation step is parameterized by its
  # driver so the resident and daemon paths share a handler, and both "nothing was lost"
  # assertions share theirs. `<source>` and `<driver>` are the handler's lookup keys and
  # must be validated against explicit KNOWN_VALUES — a handler that branches on scenario
  # shape instead never reads them, and a mutant in either column survives.

  Background:
    Given a swarm whose roles were composed at an earlier commit

  # BL-911 landed-prose-reaches-the-role-at-next-rotation-01
  Scenario Outline: prose landed after launch reaches the role at its next rotation
    Given "<source>" carries a rule the running swarm was not composed with
    When the rotation to "hardender" is driven by "the resident"
    Then the prompt "hardender" boots on carries that rule

    Examples:
      | source                          |
      | the role prompt                 |
      | an inlined constitution article |
      | the pipeline article            |

  # BL-911 every-rotation-driver-recomposes-02
  Scenario Outline: whichever driver rotates the role, it boots on a freshly composed prompt
    Given "the role prompt" carries a rule the running swarm was not composed with
    When the rotation to "hardender" is driven by "<driver>"
    Then the prompt "hardender" boots on carries that rule

    Examples:
      | driver             |
      | the resident       |
      | the daemon's chase |

  # BL-911 a-failed-composition-keeps-the-previous-prompt-03
  Scenario: a composition that fails leaves the previous prompt in place, and the role still boots
    Given the sources for "hardender" cannot be composed
    When the rotation to "hardender" is driven by "the resident"
    Then the rotation still completes
    And the prompt "hardender" boots on carries everything it carried before
    And the composition failure is reported

  # BL-911 recomposing-never-loses-prose-04
  Scenario: a role whose sources are unchanged boots on a prompt that lost nothing
    Given no source for "hardender" has changed since the swarm was composed
    When the rotation to "hardender" is driven by "the resident"
    Then the prompt "hardender" boots on carries everything it carried before

  # BL-917 extends this file rather than opening its own, because the defect it
  # closes IS an incomplete enumeration: BL-911 fixed the paths that re-exec a
  # launch script to become ANOTHER role, and missed the one that re-execs to
  # become the SAME role. Splitting the two across two files would put the
  # enumeration in two places, which is the shape of the original miss. These
  # do not fit scenario 02's Examples table: that step rotates TO a target
  # role, while an idle-boundary clear respawns the current role in place.

  # BL-917 idle-clear-respawn-recomposes-05
  Scenario: an idle-boundary clear boots the same role on a freshly composed prompt
    Given "the role prompt" carries a rule the running swarm was not composed with
    And idle-clear is enabled for "hardender"
    When "hardender" reaches its idle boundary
    Then the prompt "hardender" boots on carries that rule

  # BL-917 idle-clear-failed-composition-still-boots-06
  Scenario: a composition that fails at an idle clear still boots the role
    Given the sources for "hardender" cannot be composed
    And idle-clear is enabled for "hardender"
    When "hardender" reaches its idle boundary
    Then the clear still completes
    And the prompt "hardender" boots on carries everything it carried before
    And the composition failure is reported

  # BL-917 idle-clear-off-changes-nothing-07
  Scenario: with idle-clear off, the idle boundary neither respawns nor recomposes
    Given idle-clear is disabled for "hardender"
    When "hardender" reaches its idle boundary
    Then no respawn happens
    And the composed prompt for "hardender" is left untouched
