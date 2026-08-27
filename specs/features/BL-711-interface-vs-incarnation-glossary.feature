# mutation-stamp: sha256=5f4add36867e28c91c03cebc89bd14cae4354d4650cb1c5ebba7ba3909583b3e
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-27T11:39:12.741723910Z","feature_name":"Docs name both the interface and its incarnation","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-711-interface-vs-incarnation-glossary.feature","background_hash":"f1f6087ab5ca2cb8167dc0ce254302c0dae3f48160cda33969f1ff28e8fc8d2d","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the glossary pairs each interface with today's incarnation","scenario_hash":"c32adf6e9daec0828968e339d49fe3d8ce85bbe6cf62c83b2e78394416de6ad4","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-27T11:39:12.741723910Z"}]}
# acceptance-mutation-manifest-end

Feature: Docs name both the interface and its incarnation
  Architecture prose may say messaging and host agent; operators still say
  Telegram and Cursor; the phone app is Bubble. The docs state that duality
  explicitly so nobody mistakes it for a ubiquitous-language failure and
  launches a rename sweep.
  Source: human via Let's Talk / Cursor 2026-07-30; BL-711.

  Background:
    Given the project specification reference document

  # BL-711 vocabulary-01
  Scenario Outline: the glossary pairs each interface with today's incarnation
    When I read the vocabulary section
    Then it names the interface <interface>
    And it names <incarnation> as that interface's current incarnation

    Examples:
      | interface  | incarnation |
      | messaging  | Telegram    |
      | host agent | Cursor      |

  # BL-711 vocabulary-02
  Scenario: the phone app is named Bubble
    When I read the vocabulary section
    Then it gives Bubble as the product name of the operator phone app
    And it does not introduce a second brand for that app

  # BL-711 vocabulary-03
  Scenario: the two layers are stated as deliberate
    When I read the vocabulary section
    Then it says architecture prose may use the interface words
    And it says operator instructions keep the incarnation names

  # BL-711 vocabulary-04
  Scenario: closing this work renames nothing
    When I inspect the change that adds the vocabulary section
    Then it changes prose only
    And no identifier, environment variable, filename, or operator verb is renamed
