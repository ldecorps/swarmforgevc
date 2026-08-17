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
