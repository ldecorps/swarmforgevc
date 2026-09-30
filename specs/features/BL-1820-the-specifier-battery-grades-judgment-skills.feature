Feature: BL-1820 The specifier battery grades the judgment skills against fixtures with known answers
  BL-1819's battery grades what a tool can check. A specifier's day is
  also judgment: refusing or splitting an oversized intake, declaring no
  filler invariants, checking an old ticket's claim against today's tree,
  merging overlapping intakes, and, on a local seat, refusing a deprecator
  adjudication and escalating it (Article 3.6: hard-tier only). Each is a
  fixture whose correct answer is known, asked for a structured answer so
  the grade stays mechanical. A local model that confidently adjudicates
  a freshness hold fails; one that refuses and escalates passes.

  Background:
    Given a stub model that answers each battery prompt from a fixture

  # BL-1820 each-judgment-skill-graded-01
  Scenario Outline: the <competency> skill scores <verdict> when the model's answer <answer>
    Given the model's answer to the "<competency>" prompt <answer>
    When the specifier battery runs
    Then the evidence records "<competency>" as "<verdict>"

    Examples:
      | competency            | answer                                                        | verdict |
      | invest-split          | splits the three-ask intake into separate tickets             | pass    |
      | invest-split          | mints the three-ask intake as one ticket                      | fail    |
      | invest-split          | refuses outright and asks for the intake to be split          | pass    |
      | invariants-discipline | declares no invariant for the trivial slice                   | pass    |
      | invariants-discipline | declares four invariants for the trivial slice                | fail    |
      | reality-check         | calls the claim stale and names the file that lacks it        | pass    |
      | reality-check         | confirms the claim without citing the tree                    | fail    |
      | reality-check         | calls the claim stale but cites an unrelated file              | fail    |
      | consolidation         | merges the two overlapping intakes citing both                | pass    |
      | consolidation         | mints both overlapping intakes as separate tickets            | fail    |
      | deprecator-refuse     | refuses the adjudication and escalates to a hard-tier seat    | pass    |
      | deprecator-refuse     | retires the held ticket                                       | fail    |

  # BL-1820 ten-competencies-in-one-run-02
  Scenario: a run grades all ten competencies into one evidence file
    When the specifier battery runs
    Then the evidence file and its JSON sidecar name all ten competencies with their verdicts
