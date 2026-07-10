Feature: In French, the PWA shows ticket (and doc) sentences translated, with jargon preserved

  # Follow-up to BL-118: in French the chrome is translated but the ticket titles/
  # descriptions and doc content — the English text the operator authors — stay
  # English (screenshot 2026-07-10). Operator decision: "sentences have to be
  # translated; jargon terms can stay in English." So ordinary prose renders in
  # French while jargon tokens (BL-ids, role names, product/tech terms) remain.
  # pwa/app.js already has the delivery hook: ticketTitle() returns ticket.titleFr
  # when in French (pwa/app.js:183) — but nothing populates titleFr today.
  #
  # OPEN DESIGN DECISION (architect + human must resolve before build): HOW French
  # content is sourced. Candidates: an automated translation step at dashboard-build
  # time that fills titleFr (and description/doc equivalents) with a jargon
  # preserve-list, vs human-authored titleFr. This has real cost/infra implications
  # (a translation service, secret handling, the PWA's no-localStorage/offline
  # rules, per-build cost) and is NOT settled by this contract. Smallest first
  # slice is titles only (the titleFr hook exists); descriptions/docs follow.

  # BL-230 title-fr-01
  Scenario: a ticket title renders as a French sentence in French mode
    Given a ticket whose English title is a prose sentence and a French translation exists
    When the board is rendered in French
    Then the title is shown translated to French

  # BL-230 jargon-preserved-02
  Scenario: jargon tokens are preserved inside the French title
    Given a ticket title containing jargon such as a BL-id, a role name, or a product/tech term
    When it is shown in French
    Then those jargon tokens remain in English within the French sentence

  # BL-230 fallback-03
  Scenario: a ticket with no French translation falls back to its original text
    Given a ticket whose French translation is unavailable
    When the board is rendered in French
    Then it falls back to the original title text, never an error or a blank

  # BL-230 english-unchanged-04
  Scenario: English mode is unchanged
    Given the PWA in English
    When the board is rendered
    Then ticket titles show their authored English text

# Non-behavioral gates:
#  - Delivery reuses the existing ticketTitle() titleFr hook (pwa/app.js:183) for
#    titles; descriptions/docs need an equivalent field. The translation SOURCE is
#    a build-time input to backlog.json (backlogDashboard.ts), never a runtime
#    browser call — respect the PWA storage/secret + offline constraints.
#  - The jargon preserve-list is a defined, reviewable list (BL-ids and role names
#    at minimum), not ad hoc per translation.
#  - This item is a PROPOSAL pending the design decision above; do not promote to
#    build until the translation mechanism + its cost are confirmed by a human.
