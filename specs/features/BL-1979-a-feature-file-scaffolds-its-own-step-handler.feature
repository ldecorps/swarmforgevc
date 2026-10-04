Feature: BL-1979 A feature file scaffolds its own step handler

  Every ticket with an acceptance feature needs a step handler: a
  specs/pipeline/steps/<Name>Steps.js file exporting registerSteps, which
  scopes one definition per step text to the feature's name with
  registry.defineScoped (BL-1371 discovers the file by its name). Nothing
  writes that skeleton; each seat learns it from the runner's internals and
  other tickets' handlers. On 2026-10-04 the iq3 coder, holding BL-1970,
  read the runner's registry, adapter, generator and runtime, then read one
  example handler and one test about thirty times each for over half an
  hour without writing a line. The scaffold writes the skeleton from the
  feature, so a seat starts from a file to fill in.

  Background:
    Given a feature file with a Background, two scenarios and a Scenario Outline whose steps use a placeholder

  # BL-1979 the-scaffold-writes-a-discoverable-handler-01
  Scenario: the scaffold writes a handler file the runner discovers
    When the scaffold runs for that feature with a handler name ending in Steps
    Then a file of that name is written under specs/pipeline/steps exporting registerSteps

  # BL-1979 every-step-resolves-to-a-scoped-stub-02
  Scenario: every step text in the feature resolves to a stub scoped to the feature
    When the scaffold runs for that feature with a handler name ending in Steps
    Then loading the written file into a fresh registry resolves every step of the feature, Background steps included, under the feature's name

  # BL-1979 a-placeholder-becomes-a-capture-03
  Scenario: a step with a placeholder resolves for every value its Examples give
    When the scaffold runs for that feature with a handler name ending in Steps
    Then each Examples value of the placeholder resolves to the same stub, which receives that value

  # BL-1979 an-unfilled-stub-fails-naming-its-step-04
  Scenario: a scenario run against the unfilled scaffold fails naming its first step
    When the scaffold runs for that feature with a handler name ending in Steps
    And the feature's first scenario runs against the written file
    Then it fails naming that scenario's first step as not implemented, not as a step with no handler

  # BL-1979 an-existing-handler-is-never-overwritten-05
  Scenario: the scaffold never overwrites a handler file that already exists
    Given a handler file of that name already exists
    When the scaffold runs for that feature with a handler name ending in Steps
    Then the scaffold exits non-zero naming the file
    And the existing file is unchanged
