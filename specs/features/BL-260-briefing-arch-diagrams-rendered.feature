Feature: the morning briefing email renders the architecture diagrams inline

  # Operator direction 2026-07-10 (via coordinator): "I need the architecture
  # diagrams rendered in the morning email as well." Opening the morning briefing
  # should SHOW the diagram, not just link to a .mmd source.
  #
  # Verified assets: sources exist (docs/diagrams/architecture.mmd, swarm-flow.mmd);
  # the briefing send path is ((:send-email! adapters) subject content) with content
  # = markdown TEXT; the Resend adapter (resendClient.ts) today sends {subject, text}
  # only (no html/attachments); NO Mermaid renderer is installed.
  #
  # This ADDS a rendered-diagram section — it reuses the diagram sources, the BL-214
  # send, the BL-258 morning schedule, and the BL-099/BL-256 content; it does not
  # fork the briefing or the send. Render must be LOCAL, PINNED, DETERMINISTIC (an
  # external render service that ships diagrams off-machine is rejected by default —
  # reproducibility/privacy — unless the operator explicitly accepts it).
  #
  # SEQUENCING: touches the shared briefing-compose path (briefing_email_lib.bb / the
  # Resend adapter) that BL-256 and BL-258 also touch — must NOT be built concurrently
  # with them (coordinator orthogonality).

  Background:
    Given the project's Mermaid architecture diagrams under docs/diagrams/

  # BL-260 rendered-inline-01
  Scenario: the morning briefing email shows the architecture diagram rendered inline
    Given the daily briefing is generated with rendering available
    When the email body is composed
    Then it includes the architecture diagram rendered as an inline image

  # BL-260 local-deterministic-02
  Scenario: the diagram is rendered locally and deterministically
    Given the same Mermaid source
    When it is rendered twice
    Then it produces byte-identical image output
    And the render runs locally without sending the diagram to an external service

  # BL-260 plaintext-degradation-03
  Scenario: a client that does not render HTML still gets a readable briefing
    Given the email is sent multipart with an HTML part and a plaintext part
    When a plaintext-only client opens it
    Then it shows the briefing text with a link or note for the diagram

  # BL-260 render-unavailable-degradation-04
  Scenario: if rendering is unavailable the email still sends
    Given the diagram renderer is unavailable
    When the briefing email is generated
    Then the email still sends with a clear no-diagram note rather than failing

  # BL-260 render-fixture-well-formed-05
  Scenario: rendering a fixture diagram yields a well-formed image
    Given a fixture Mermaid source
    When the render step runs
    Then it yields a non-empty well-formed image
