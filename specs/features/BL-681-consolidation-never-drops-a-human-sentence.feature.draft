Feature: a consolidation never drops a human sentence

  BL-680 lets the specifier merge several intakes into one ticket and split one
  intake into several. Both operations rewrite the shape of what the human
  asked for, and the only thing standing between a rewrite and a quiet loss is
  the rule that every sentence the human wrote survives it verbatim.

  That rule is being ratified as constitutional law rather than left in
  specifier.prompt, for one reason: it has to bind every future consolidator.
  The specifier holds the authority today; a coordinator or an operator agent
  could hold it tomorrow, and a rule living in one role's contract would not
  reach them. So the clause names no role — it binds the ACT.

  Article 5.1 governs its adoption: a constitutional change is ratified by an
  explicit human decision, never by a pipeline merge alone.

  Background:
    Given the constitution's amendments article

  # BL-681 human-sentence-clause-01
  Scenario: the clause exists and binds the act rather than a role
    Then it states that a consolidation never drops a human sentence
    And the clause names no specific role as its subject

  # BL-681 human-sentence-clause-02
  Scenario: the clause says what surviving means
    Then it states that every directive quoted from a human survives verbatim
    And it states that a consolidation which cannot preserve one is refused rather than trimmed

  # BL-681 human-sentence-clause-03
  Scenario: the clause is reachable from the role that exercises the authority
    Given the specifier role prompt
    Then it cites the constitutional clause as the binding source of the rule
