Feature: BL-1813 Upstream's podium agent measured against the Baton orchestra
  Upstream unclebob/swarm-forge is building a layer above its packs: one
  agent on the podium coordinating several ensembles across projects (its
  `lieutenant` and `project-manager` branches call these a lieutenant, a
  squad and a platoon). Baton (BL-242) already answers the same question
  in orchestra terms: a player is an agent, a conductor and an ensemble
  make a swarm, an orchestra is a fleet of ensembles, and the podium is a
  console that talks to conductors, never to players. This slice writes a
  one-page fit note comparing the two and records the decision, with no
  code and no install of upstream's layer. The same entry records the
  2026-09-29 disposition of every row of the upstream drift survey.

  # BL-1813 every-survey-row-dispositioned-01
  Scenario Outline: the 2026-09-29 entry records a disposition for survey row <row>
    When the 2026-09-29 upstream drift survey entry in docs/upstream-deviations.md is read
    Then row <row> is recorded as <disposition>

    Examples:
      | row | disposition                    |
      | A   | adopted, naming BL-1811        |
      | B   | already covered, naming BL-485 |
      | C   | validation run, naming BL-1812 |
      | D   | deferred, naming BL-1813       |
      | E   | skipped                        |
      | F   | deferred                       |
      | G   | skipped                        |

  # BL-1813 fit-note-records-the-podium-decision-02
  Scenario: the fit note records the podium decision with its revisit triggers and is linked from the index
    When the fit note docs/explanation/upstream-podium-agent-vs-baton.md is read
    Then it records the podium-agent decision as deferred
    And it names both revisit triggers: a true multi-repository forge product, and an operator control need that Telegram and Bubble cannot cover
    And docs/index.md links to it
