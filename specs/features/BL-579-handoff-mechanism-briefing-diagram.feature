Feature: the morning briefing carries a handoff-MECHANISM diagram alongside architecture and swarm-flow

  # BL-579. Human, 2026-07-23: "can an activity diagram be produced, and
  # added, to morning briefing, documenting how the handoff mechanism
  # works?" swarm-flow.mmd documents WHO hands off to WHOM; nothing
  # documents HOW a parcel physically travels - the file lifecycle, the two
  # gates that can refuse a claim, the daemon sweeps that wake a role not
  # looking at its own mailbox. That is the single most common source of
  # "the handoff vanished" confusion: a queued-but-unread parcel in a
  # dormant role's inbox/new/ looks identical to one that was never sent.
  #
  # The rendering machinery already exists (BL-260 render, BL-286 cid
  # attachments), so the slice is a third diagram source plus one allowlist
  # entry. These scenarios therefore assert only what is NEW - that the
  # third diagram participates in the paths the other two already ride, and
  # that a bad source for it fails loudly. BL-260 and BL-286 keep their own
  # contracts; this file does not restate them.
  #
  # Counts are derived from the allowlist, never written as a literal, so
  # adding a fourth diagram later does not turn a correct file red
  # (BL-643/BL-1005). The allowlist stays an allowlist and is deliberately
  # not a directory scan, so a stray experimental .mmd is never emailed out.

  Background:
    Given the morning briefing's diagram allowlist names the handoff-mechanism diagram

  # BL-579 every-allowlisted-source-renders-01
  Scenario: every allowlisted diagram renders from its committed source, the new one included
    When the briefing's diagrams are rendered from the committed sources
    Then one rendered diagram is produced for each name in the allowlist
    And the handoff-mechanism diagram is among them
    And every rendered diagram carries non-empty image bytes

  # BL-579 new-diagram-rides-the-cid-path-02
  Scenario: the new diagram rides the same cid path as the diagrams already there
    Given the briefing's diagrams have been rendered
    When the briefing email is built
    Then the handoff-mechanism diagram is referenced by its own cid
    And the email carries one inline attachment per referenced diagram

  # BL-579 a-malformed-new-source-fails-loudly-03
  Scenario: a handoff diagram source that does not parse fails loudly, never silently
    Given the handoff-mechanism diagram source does not parse
    When the briefing's diagrams are rendered from the committed sources
    Then the render run reports failure
    And the briefing email still sends with its no-diagram note
