Feature: Let's Talk hold music expands with iconic chiptunes
  Expand the Mini App hold-music catalog with Thanatos, Ghost'n Goblins,
  Zelda, Tron, and other short iconic homage loops. Stay on the existing
  Web Audio step player — no YM decoder in this ticket. Source: GH #28.

  Background:
    Given the Let's Talk hold-music chiptune catalog is available
    And hold music remains quiet and toggleable

  # BL-705 chip-01
  Scenario: catalog includes the named iconic themes
    When the hold-music song list is inspected
    Then it includes a song titled like Thanatos
    And it includes a song titled like Ghost'n Goblins
    And it includes a song titled like Zelda
    And it includes a song titled like Tron
