Feature: BL-2119 A prepared local-coder alias never carries a vision projector

  local_model_prepare_lib.bb's prepare! renders a Modelfile whose FROM is
  the base tag, so a multimodal base's CLIP projector layer is copied into
  the prepared alias. The coder seat is text and code only: on 2026-10-10
  the slevinw Qwen3.6-35B-A3B alias carried a 902,822,240-byte projector,
  about 861 MiB of VRAM with no consumer. prepare! now reads the base's
  manifest and points FROM at the model layer's blob, so no projector
  layer is ever carried, whatever the base.

  Background:
    Given an ollama models directory under a temporary root
    And a fake ollama on the PATH that records every create it is asked for

  # BL-2119 prepare-strips-the-projector-01
  Scenario Outline: the prepared Modelfile's FROM is the base's model blob, never its projector
    Given the models directory holds a manifest for "<base>" with a model layer and <projector layers> projector layer
    When the base "<base>" is prepared
    Then the prepared Modelfile has exactly one FROM line, naming the model layer's blob file
    And the prepared Modelfile names no projector blob
    And the fake ollama was asked to create the prepared alias once

    Examples:
      | base                                   | projector layers |
      | hf.co/org/vision-repo:IQ3_S            | one              |
      | hf.co/org/text-repo:Q4_K_M             | no               |
      | qwen-library-model:latest              | one              |

  # BL-2119 prepare-records-the-strip-02
  Scenario: the profile records what was stripped
    Given the models directory holds a manifest for "hf.co/org/vision-repo:IQ3_S" with a model layer and one projector layer
    When the base "hf.co/org/vision-repo:IQ3_S" is prepared
    Then the profile records the model blob it was built from
    And the profile records that a projector was stripped

  # BL-2119 prepare-without-a-manifest-fails-03
  Scenario: a base that was never pulled fails before any create
    When the base "hf.co/org/never-pulled:Q4_K_M" is prepared
    Then the prepare fails naming "hf.co/org/never-pulled:Q4_K_M" and the models directory
    And the fake ollama was asked to create nothing

  # BL-2119 dry-run-keeps-the-tag-04
  Scenario: a dry run of a base with no manifest keeps the tag
    When the base "hf.co/org/never-pulled:Q4_K_M" is prepared as a dry run
    Then the prepared Modelfile's FROM line names "hf.co/org/never-pulled:Q4_K_M"
    And the profile records that the FROM line was not resolved to a blob
