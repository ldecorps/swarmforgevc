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
