Feature: the pipelineBoard prefix-order property test matches the actual link-line render format

  # BL-559: the property "included links are always an in-order PREFIX of the
  # input, and omittedCount is exact" fails reliably (minimal counterexample
  # [1,112]) because its assertion checks for the substring "${id}:" while
  # pipelineBoardLinkLine() actually renders "<a href="...">L0</a>" — no
  # colon anywhere near the id. Diagnosed as a test-assertion bug, not a bug
  # in budgetPipelineBoardLinks/trimLinksToBudget's trimming/ordering/budget
  # logic; coder confirms the diagnosis before picking a fix.

  # BL-559 all-seven-properties-pass-01
  Scenario: the full pipelineBoard property suite passes, including the previously failing property
    When "npx vitest run --config vitest.properties.config.mjs test/pipelineBoard.property.test.js" runs
    Then all 7 properties pass

  # BL-559 passes-reliably-across-random-seeds-02
  Scenario: the fixed prefix-order property passes across multiple randomized-seed runs
    Given property tests use randomized seeds each run
    When the suite runs at least twice
    Then the prefix-order property passes on every run, not only one seed

  # BL-559 minimal-counterexample-no-longer-fails-03
  Scenario: the previously failing minimal counterexample no longer fails
    Given the input [1, 112] that previously shrunk to a failing case
    When the prefix-order property is checked against it
    Then it passes
