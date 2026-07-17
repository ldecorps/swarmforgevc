Feature: a role-held ticket resolves to its stage even when its handoff header does not lead with the id

  # BL-474 audit finding #3 (real, latent). extract-ticket-id anchors on
  # ^([A-Za-z]+-\d+), so a held ticket whose task/message header carries any
  # textual prefix before the id ("Re: BL-476 …", "continuing BL-476 …")
  # resolves to nothing — a durable false not-started, indistinguishable on the
  # board from a legitimately un-dequeued ticket. The fix resolves the FIRST
  # ticket-id-shaped token in the header regardless of leading position, staying
  # deterministic (first id token wins, still upper-cased); a header with no
  # id-shaped token still resolves to nothing.

  # BL-488 held-ticket-id-resolves-without-leading-token-01
  Scenario Outline: the held ticket's id is resolved from the first id-shaped token in its header, wherever it sits
    Given a role holds a ticket whose handoff header text is "<header_text>"
    When the board resolves the held ticket's id
    Then it resolves to ticket "<resolved_id>"

    Examples:
      | header_text                   | resolved_id |
      | BL-476 do the thing           | BL-476      |
      | Re: BL-476 do the thing       | BL-476      |
      | continuing BL-476 next slice  | BL-476      |
      | no id-shaped token here       | NONE        |
