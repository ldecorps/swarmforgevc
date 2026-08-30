Feature: A reverse-hop copy does not block the forward it was synthesized from

  BL-760's duplicate-chain guard refuses a git_handoff when the same ticket
  already has a live parcel in another role's mailbox - the send-time check
  that catches one ticket forking into two concurrent chains.

  Reverse hops (Article 2.3) make that shape routine and harmless. A
  back-one or back-all forward synthesizes priority-00 `non-forwarding: true`
  copies into earlier roles' mailboxes, so the moment a role forwards, the
  ticket has live parcels in up to five other mailboxes. Every one of them
  reads to the guard as a competing chain, and the NEXT role's forward is
  refused until each recipient has drained its copy.

  A non-forwarding inbound cannot start a chain: its recipient is forbidden
  to forward it (Article 2.4 - merge-only). So it can never be the thing the
  guard exists to catch.

  Observed 2026-08-30: the hardener's forward of BL-1297 - a critical
  land-step fix - was refused naming the architect's back-all copy sitting in
  the specifier's in_process. It cleared six minutes later when that copy was
  drained. On a router pack, where a reverse recipient may be dormant for far
  longer, the same window is unbounded.

  Background:
    Given a role is sending a forward git_handoff for a ticket

  # BL-1302 reverse-hop-copy-is-not-a-duplicate-chain-01
  Scenario: a live reverse-hop copy does not block the forward
    Given another role's mailbox holds a live parcel for that ticket marked non-forwarding
    When the duplicate-chain guard evaluates the send
    Then the send is not blocked

  # BL-1302 reverse-hop-copy-is-not-a-duplicate-chain-02
  Scenario: a genuine competing chain is still refused
    Given another role's mailbox holds a live forward parcel for that ticket
    When the duplicate-chain guard evaluates the send
    Then the send is blocked naming that parcel

  # BL-1302 reverse-hop-copy-is-not-a-duplicate-chain-03
  # Absence buys nothing: only an explicit non-forwarding marker exempts a
  # parcel, so a malformed or pre-reverse-hop parcel blocks exactly as today.
  Scenario: a parcel carrying no non-forwarding marker still blocks
    Given another role's mailbox holds a live parcel for that ticket with no non-forwarding marker
    When the duplicate-chain guard evaluates the send
    Then the send is blocked naming that parcel
