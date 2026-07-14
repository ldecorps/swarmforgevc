Feature: Briefing diagrams survive Gmail — sent as cid attachments, not data-URIs

  Background:
    Given the briefing email renders architecture diagrams into its HTML part

  # BL-286 diagram-cid-01
  Scenario: available diagrams are referenced by a cid image source, not a data-URI
    Given a briefing whose architecture diagrams are available
    When the briefing email HTML is built
    Then each diagram is referenced by a cid image source
    And the HTML contains no data-URI image source

  # BL-286 diagram-cid-02
  Scenario: each referenced diagram is carried as a matching inline attachment
    Given a briefing email that references its diagrams by cid
    When the send payload is built
    Then it carries one inline attachment per referenced diagram
    And each attachment's content id matches the cid that references it

  # BL-286 diagram-cid-03
  Scenario: each diagram attachment carries the image bytes and a filename
    Given a briefing email whose diagrams are sent as inline attachments
    When the send payload is built
    Then each attachment carries the diagram's image bytes and a filename

  # BL-286 diagram-cid-04
  Scenario: a run with no available diagrams still sends plaintext with no attachments
    Given a briefing run where no diagrams are available
    When the briefing email is sent
    Then the email sends with the unavailable-diagrams plaintext note
    And its send payload carries no attachments

  # BL-286 diagram-cid-05
  Scenario: a briefing with no diagram section sends the prior payload unchanged
    Given a briefing send that has no diagram section at all
    When the briefing email is sent
    Then the send payload has neither an attachments field nor an html field
