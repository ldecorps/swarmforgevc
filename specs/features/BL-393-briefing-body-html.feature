Feature: the briefing email renders its body to HTML so the observables are readable on a phone

  Background:
    Given a committed daily briefing sent by the headless daemon

  # BL-393 body-html-01
  Scenario: the briefing body is sent as a rendered HTML part alongside the plain-text markdown
    Given a briefing whose body is markdown
    When the briefing email payload is built
    Then the payload carries an HTML part rendered from the briefing body
    And the payload still carries the original markdown as its plain-text part

  # BL-393 body-html-02
  Scenario: markdown structure renders as distinct HTML elements
    Given a briefing body containing headings, a metrics table, and bold text
    When the briefing email payload is built
    Then the HTML part's headings render as HTML heading elements
    And the HTML part's table renders as HTML table markup
    And the HTML part's bold text renders as HTML emphasis

  # BL-393 body-html-03
  Scenario: appended computed sections are included in the rendered body
    Given a briefing whose content has appended computed sections
    When the briefing email payload is built
    Then the HTML part includes those appended sections, not only the lede

  # BL-393 body-html-04
  Scenario: available diagrams appear in the HTML part together with the rendered body
    Given a briefing run whose architecture diagrams are available
    When the briefing email payload is built
    Then the HTML part contains both the rendered briefing body and the diagram images
    And neither replaces the other

  # BL-393 body-html-05
  Scenario: a run with no diagrams still sends the rendered body as HTML
    Given a briefing run where no diagrams are available
    When the briefing email payload is built
    Then the payload carries an HTML part rendered from the briefing body
