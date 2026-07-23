Feature: PromptEngine composes from named fragments with per-model adapters

  BL-546 Slice 2. Slice 1 landed composition; this slice makes the pieces
  addressable and the model-specific wording pluggable, so that adding support
  for a new model is a registration rather than an edit to the compose path,
  and an unchanged fragment is not re-read on every compose.

  Materialized from the parked design in
  specs/features/BL-546-prompt-engine-slices-2-3.feature.draft. Slice 3
  (versioning, validation, inspect CLI) stays parked there.

  Background:
    Given a PromptEngine compose request for role "coder"

  # BL-574 fragment-assembly-01
  Scenario Outline: a named fragment contributes its content to the composed prompt
    Given the compose request includes fragment "<fragment>"
    When PromptEngine composes the system prompt
    Then the composed prompt includes content from fragment "<fragment>"

    Examples:
      | fragment     |
      | constitution |
      | pipeline     |
      | role         |
      | pack-overlay |

  # BL-574 model-adapter-selection-02
  Scenario Outline: the adapter is chosen from the model and provider
    Given the compose request targets model "<model>" on provider "<provider>"
    When PromptEngine applies the model adapter
    Then the selected adapter id is "<adapter>"
    And the constitution fragment content is unchanged

    Examples:
      | provider | model           | adapter      |
      | claude   | claude-sonnet-5 | generic      |
      | aider    | mistral-large   | aider-editor |

  # BL-574 adapter-registration-03
  Scenario: an adapter registered after startup is selected without touching compose logic
    Given an adapter is registered for provider "newprovider"
    When the compose request targets provider "newprovider"
    Then the selected adapter id is "newprovider"

  # BL-574 fragment-cache-hit-04
  Scenario: an unchanged fragment is not re-read on the next compose
    Given PromptEngine has already composed the system prompt once
    And no fragment file has changed since that compose
    When PromptEngine recomposes the system prompt
    Then no fragment file is re-read

  # BL-574 fragment-cache-invalidation-05
  Scenario: a changed fragment is re-read and its new content composed
    Given PromptEngine has already composed the system prompt once
    And fragment "role" has changed on disk since that compose
    When PromptEngine recomposes the system prompt
    Then fragment "role" is re-read
    And the composed prompt carries the changed content
