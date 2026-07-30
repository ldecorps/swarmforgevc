Feature: The non-pipeline agents are documented as a class, with every path verified

  The swarm has a whole category of agents that are not pipeline roles — conversational
  ones, supervisory ones, transport ones, and the Expeditor, which is none of those
  because it wears the pipeline's own hats with the swarm stopped. No document names
  that category or says what makes it different, so a reader cannot answer the basic
  operational questions: what starts this thing, what stops it, who supervises it,
  where do its logs go, and is there an authored description of its behaviour at all.

  Coverage is uneven and nobody planned the unevenness — 21 files for the operator,
  zero for the resident spy tunnel. The fix is a class document plus one reference
  table, and the table is the load-bearing part: it is only worth having if every
  path in it was checked against the repo rather than recalled. A wrong stop path in
  a document is the BL-637 defect in a new place, and a table is exactly where that
  defect hides.

  Two honesty constraints shape the rest. The Onboarder is half-built — slice 1 is on
  `main`, slices 2 and 3 are not — so the document describes what shipped and names
  the ticket owning each phase that did not; a document that describes unbuilt
  behaviour is worse than a missing one, because the reader cannot tell which half is
  real. And several agents have no role prompt, meaning their description can only be
  reverse-engineered from code — the reader is told when that is what happened.

  The naming question this ticket was filed alongside is NOT here. BL-684 shipped the
  rename and shipped its own permanent gate for it; a scenario restating that check
  would be a second gate over one behaviour, and would force this file into BL-684's
  residual-word allowlist for no gain. The dependency is carried as data instead.

  Background:
    Given the non-pipeline agent documentation has been written

  # BL-643 agent-class-doc-01
  Scenario: every non-pipeline agent in the repo has a row in the reference table
    When the repo's non-pipeline agents are enumerated from their launchers
    Then every enumerated agent has a row in the reference table
    And the table has no row for an agent that does not exist

  # BL-643 agent-class-doc-02
  Scenario Outline: every row answers the operational questions
    When a row of the reference table is read
    Then it states the agent's <column>

    Examples:
      | column                      |
      | category                    |
      | launcher                    |
      | stop path                   |
      | role prompt, or its absence |
      | log location                |
      | supervising service         |

  # BL-643 agent-class-doc-03
  Scenario Outline: every path printed in the table resolves in the repo
    When the <path kind> named in each row is resolved against the repo
    Then it exists
    And no row names a path that was recalled rather than checked

    Examples:
      | path kind   |
      | launcher    |
      | stop path   |
      | role prompt |

  # BL-643 agent-class-doc-04
  Scenario: an agent described without a role prompt is marked as reverse-engineered
    Given an agent that has no role prompt
    When its description is read
    Then the description says it was derived from code
    And the reader is not left to assume it was authored

  # BL-643 agent-class-doc-05
  Scenario Outline: the table explains its own irregular cases instead of omitting them
    Given <irregular case>
    When that agent is looked up in the reference table
    Then it has a row of its own
    And the row explains why it does not follow the usual shape

    Examples:
      | irregular case                                                   |
      | an agent with a role prompt but no launcher                      |
      | an agent whose authored description lives under another's prompt |
      | an agent that is a driver rather than a launched process         |

  # BL-643 agent-class-doc-06
  Scenario: the Onboarder document covers only what shipped
    When the Onboarder document is read
    Then every behaviour it describes is present on the main branch
    And each unshipped phase is named with the ticket that owns it

  # BL-643 agent-class-doc-07
  Scenario: the Expeditor is linked rather than restated
    When the class document reaches the Expeditor
    Then it links the existing Expeditor documents
    And it does not restate their content

  # BL-643 agent-class-doc-08
  Scenario: the new documents are reachable from the documentation index
    When the documentation index is read
    Then every document added by this work is linked from it
    And the link was added in the same commit as the document
