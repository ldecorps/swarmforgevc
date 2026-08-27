Feature: BoB starting cast is steward-exported and applied via existing assignment paths

  # BL-1181 (epic BL-1180). Cherry-pick starting cast; reuse ModelFactory/pack.

  Background:
    Given Model Steward rankings and ModelFactory assignment surfaces

  # BL-1181 steward-exports-cast-01
  Scenario: steward exports a BoB cast with one recommended model per role
    When the steward cherry-picks a BoB starting cast
    Then the cast names exactly one provider and model per role
    And mixed vendors are allowed across roles

  # BL-1181 apply-reuses-modelfactory-02
  Scenario: applying the cast uses the existing ModelFactory or pack model path
    Given a BoB starting cast export
    When the cast is applied
    Then assignment goes through ModelFactory or pack model apply
    And no third assignment path is invented

  # BL-1181 apply-transfers-memory-03
  Scenario: changing a role model during cast apply transfers agent memory
    Given apply would change the model for role "coder"
    When the cast is applied
    Then agent-memory transfer runs for that role before live work
