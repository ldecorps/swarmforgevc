Feature: backlog Gherkin becomes durable feature files with a lint gate

# BL-111 feature-migration-01
Scenario: active and paused Gherkin lives in feature files
  Given the backlog items in active/ and paused/ at migration time
  When the migration completes
  Then each item's scenarios exist in specs/features/ with APS naming
  And each item's YAML acceptance field references its feature file(s)
  And no done/ item was migrated

# BL-111 lint-gate-03
Scenario: a malformed feature file fails the lint gate
  Given a feature file that gherkin-parser cannot parse
  When the lint gate script runs against it
  Then the gate exits nonzero and reports the parse error

# BL-111 lint-gate-04
Scenario: a well-formed feature file passes the lint gate
  Given a feature file that parses cleanly
  When the lint gate script runs against it
  Then the gate exits zero

# Non-behavioral gates:
#  - specifier.prompt updated with the APS phases; the no-APS-tooling
#    clause removed.
#  - Tools installed under a project-local path, never resolved as
#    "latest"; bumping the pin stays a human commit.
