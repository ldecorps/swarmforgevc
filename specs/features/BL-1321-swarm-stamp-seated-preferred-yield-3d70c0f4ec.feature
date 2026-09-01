Feature: Swarm stamp-off for the seated-preferred chase-rotate yield

  Hotfix 3d70c0f4ec landed on main outside the pipeline. These scenarios
  review what it landed - they confirm or refute it and never reimplement
  it. The certification itself is a human decision recorded in the hotfix
  ledger; nothing here may write it.

  Background:
    Given the landed sources at commit 3d70c0f4ec

  # BL-1321 seated-preferred-yield-stamp-01
  Scenario Outline: the chase rotate gate decides from preferred, poked, seated and actionable
    Given a preferred actionable role "<preferred>"
    And a chase poke for role "<poked>"
    And a mono-router active-role marker naming "<seated>"
    And the poked role's mail is actionable "<actionable>"
    When the chase rotate gate decides
    Then the decided action is "<action>"
    And the decided target is "<target>"

    Examples:
      | preferred | poked     | seated | actionable | action         | target    |
      | QA        | specifier | QA     | yes        | rotate         | specifier |
      | hardender | specifier | coder  | yes        | redirect       | hardender |
      | QA        | QA        | QA     | yes        | rotate         | QA        |
      | QA        | specifier | QA     | no         | skip-broadcast | none      |
      | none      | specifier | QA     | yes        | rotate         | specifier |

  # BL-1321 seated-preferred-yield-stamp-02
  Scenario: the yield is distinguishable in the daemon log
    Given a preferred actionable role "QA"
    And a chase poke for role "specifier"
    And a mono-router active-role marker naming "QA"
    And the poked role's mail is actionable "yes"
    When the daemon performs the chase rotate
    Then the daemon logs a seated-preferred yield naming "QA" and "specifier"
    And the daemon logs no chase rotate redirect for that poke

  # BL-1321 seated-preferred-yield-stamp-03
  Scenario: the gate reads the seat marker and never the live resident identity
    Given a preferred actionable role "QA"
    And a chase poke for role "specifier"
    And a mono-router active-role marker naming "QA"
    And the poked role's mail is actionable "yes"
    And a live resident that is not "QA"
    When the chase rotate gate decides
    Then the decided action is "rotate"
    And the review records that a stale marker suppresses the redirect this hotfix preserves

  # BL-1321 seated-preferred-yield-stamp-04
  Scenario: the line-ending normalisation the commit carried is reported, not undone
    Then the review records which files commit 3d70c0f4ec re-line-ended
    And those files are left as the commit landed them

  # BL-1321 seated-preferred-yield-stamp-05
  Scenario: the review never certifies the hotfix by itself
    When the review completes with every scenario green
    Then the hotfix ledger entry for commit 3d70c0f4ec is still awaiting a human decision
