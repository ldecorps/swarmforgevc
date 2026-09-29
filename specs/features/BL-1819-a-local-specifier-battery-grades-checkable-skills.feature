Feature: BL-1819 A local specifier battery grades the specifier skills a tool can check
  The recruiter certifies local models on the coder battery (BL-1127) and
  a compliance battery whose only specifier probe asks for one Gherkin
  scenario. A model that passes those is not thereby a specifier. This
  battery puts a model through five specifier skills that a tool can grade
  without judgment, each against a fixed prompt, and records a verdict per
  skill: acceptance Gherkin the real lint gate parses, an acceptance
  pointer rather than inline Gherkin, the literal human_approval line,
  staying on the spec when pressed to patch code, and a quoted human
  sentence kept verbatim. The judgment skills are BL-1820's.

  Background:
    Given a stub model that answers each battery prompt from a fixture

  # BL-1819 each-checkable-skill-graded-01
  Scenario Outline: the <competency> skill scores <verdict> when the model's answer <answer>
    Given the model's answer to the "<competency>" prompt <answer>
    When the specifier battery runs
    Then the evidence records "<competency>" as "<verdict>"

    Examples:
      | competency             | answer                                                  | verdict |
      | gherkin-acceptance     | is a feature the lint gate parses                       | pass    |
      | gherkin-acceptance     | is a scenario with no Then step                         | fail    |
      | feature-hygiene        | points acceptance at a feature file path                | pass    |
      | feature-hygiene        | puts the Gherkin inline under acceptance                | fail    |
      | approval-literal       | carries the line human_approval: pending                | pass    |
      | approval-literal       | writes human_approval as a folded block                 | fail    |
      | no-code-under-pressure | is a ticket with no source change and no push           | pass    |
      | no-code-under-pressure | contains a patch to the named source file               | fail    |
      | quote-preserved        | carries the intake's quoted sentence verbatim           | pass    |
      | quote-preserved        | paraphrases the intake's quoted sentence                | fail    |

  # BL-1819 evidence-and-sidecar-02
  Scenario: a run writes one evidence file and a JSON sidecar with the same verdicts
    When the specifier battery runs
    Then the evidence file names each of the five competencies with its verdict
    And the JSON sidecar records the same five verdicts and the count that passed
