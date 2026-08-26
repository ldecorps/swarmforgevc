Feature: the gherkin lint gate rejects a silently-dropped wrapped step line

  # Defect (coder, 2026-07-17, BL-511): a Gherkin step whose text WRAPS onto a second
  # physical line has that second line — and any <parameters> on it — SILENTLY DROPPED by
  # the vendored APS gherkin-parser, and our gherkin_lint_gate.sh reports "parses cleanly".
  # Reproduced 2026-07-18: a step "Given a record with <telegram> Telegram / events out of
  # <total> total events" parses as only "a record with <telegram> Telegram" (parameters
  # ["telegram"] — <total> is LOST), yet the Examples table keeps its now-unreferenced
  # `total` column. Consequences: the step handler must match the TRUNCATED text, the
  # dropped <param> never reaches the handler, and a gherkin-mutator mutation of that
  # phantom column can never be killed — a silent correctness hole in the acceptance gate.
  #
  # Fix boundary: the APS parser is VENDORED and PINNED (engineering.prompt: do not modify
  # or reimplement APS). The fix lives in OUR gate (swarmforge/scripts/gherkin_lint_gate.sh,
  # plus a small testable helper if needed), which must FAIL LOUDLY rather than let the
  # silent drop through — matching the codebase's fail-loud/never-silently-drop discipline.
  # Standard Gherkin steps are single-line; the gate enforces that. Put the detection logic
  # in a pure, unit-tested helper (over the feature text + the parser's IR), not inline bash.
  #
  # Two signatures of the bug, both rejected:
  #  1. A bare continuation line inside a scenario body (a non-blank line that is not a
  #     step keyword line, a table row, a tag, a comment, a docstring, or a section header).
  #  2. An Examples column referenced by no step parameter (the param-loss signature; this
  #     also enforces the specifier's existing prune-unreferenced-columns discipline).

  # BL-515 wrapped-step-line-rejected-01
  Scenario: a step whose text wraps onto a bare continuation line is rejected
    Given a feature file whose step text continues onto a second bare line
    When the gherkin lint gate runs on it
    Then the gate fails and names the dropped continuation line

  # BL-515 phantom-examples-column-rejected-02
  Scenario: an Examples column referenced by no step is rejected
    Given a feature file with an Examples column that no step parameter references
    When the gherkin lint gate runs on it
    Then the gate fails and names the unreferenced column

  # BL-515 well-formed-single-line-feature-passes-03
  Scenario: a well-formed feature with single-line steps and a referenced Examples table passes
    Given a feature file whose steps are each one line and whose Examples columns are all referenced
    When the gherkin lint gate runs on it
    Then the gate passes cleanly
