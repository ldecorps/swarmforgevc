Feature: A secondary swarm publishes fleet status under its own name

  Two readers answer "what is this swarm called" and they do not agree.
  swarm_identity_lib.bb reads .swarmforge/swarm-identity — the file the
  launcher actually writes — then falls back to the conf, then to "primary".
  The TypeScript readSwarmName reads swarmforge/swarmforge.conf ONLY and
  otherwise returns "primary", never consulting the identity file at all.

  On the Mac primary the two happen to agree, because its conf carries no
  swarm_name and its identity file says "primary". On the WSL2 secondary
  they do not: identity says "second", so emit-fleet-status would publish
  that tree's health under the name "primary" and overwrite the primary
  swarm's own status document on any host the two share.

  Compounding it, that secondary checkout has no compiled extension output
  at all, so the publish fails every handoffd cycle with a module-not-found
  error that names a build path rather than the bring-up step it is missing.

  Background:
    Given a swarm checkout

  # BL-1010 secondary-swarm-name-01
  Scenario Outline: this swarm's name comes from its identity file first
    Given a checkout whose identity file names swarm <identity>
    And whose conf names swarm <conf>
    When the swarm's own name is looked up
    Then the resolved swarm name is <resolved>

    Examples:
      | identity | conf     | resolved |
      | second   | absent   | second   |
      | second   | primary  | second   |
      | absent   | third    | third    |
      | absent   | absent   | primary  |

  # BL-1010 secondary-swarm-name-02
  Scenario: fleet status from a secondary tree is written under that tree's own name
    Given a checkout whose identity file names swarm "second"
    When fleet status is published for that checkout
    Then the published document identifies the swarm as "second"
    And no fleet status is written under the name "primary"

  # BL-1010 secondary-swarm-name-03
  Scenario: both languages agree on the default swarm name
    Given the TypeScript and Babashka swarm-name readers
    When their default swarm name literals are compared
    Then the two literals are identical

  # BL-1010 secondary-swarm-name-04
  Scenario: a checkout with no compiled publisher names the bring-up step it is missing
    Given a checkout with no compiled extension output
    When fleet status is published for that checkout
    Then the reported failure names the compile step required to bring that swarm up
