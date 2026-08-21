Feature: the morning briefing carries a front-desk MECHANISM diagram, Telegram in and answer out

  # BL-580. Human, 2026-07-23, on being offered it alongside BL-579:
  # "yup, add it". Nothing documents how a message in Telegram reaches the
  # swarm or how an answer gets back. The path crosses five processes and
  # two auth guards, and its most surprising fact is invisible from
  # outside: the agent that answers you is the RESTRICTED front-desk
  # Operator, spawned with no tools, holding the contract, the thread
  # transcript and operator memory but no ability to read the repo. Every
  # "why didn't it know about X" traces back to that, and today it is
  # discoverable only by reading run_ancillary_front_desk.sh line by line.
  #
  # Companion to BL-579, and deliberately NOT a copy of it. BL-579 owns the
  # allowlist mechanics - one rendered diagram per allowlisted name, counts
  # derived rather than written as a literal. This file asserts only what is
  # new here: that the front-desk diagram is one of those names, that its
  # committed source really renders, and that a bad source for it fails
  # loudly rather than quietly dropping a diagram from the email. No count
  # appears anywhere in this file, so neither slice landing can turn the
  # other red (BL-643/BL-1005).

  Background:
    Given the morning briefing's diagram allowlist names the front-desk diagram

  # BL-580 front-desk-diagram-reaches-the-email-01
  Scenario: the front-desk diagram renders from its committed source and reaches the email
    When the briefing's diagrams are rendered from the committed sources
    Then the front-desk diagram is among them carrying non-empty image bytes
    And the briefing email references the front-desk diagram by its own cid
    And that reference is matched by an inline attachment carrying those bytes

  # BL-580 a-malformed-front-desk-source-fails-loudly-02
  Scenario: a front-desk diagram source that does not parse fails loudly, never silently
    Given the front-desk diagram source does not parse
    When the briefing's diagrams are rendered from the committed sources
    Then the render run reports failure
    And the briefing email still sends with its no-diagram note
