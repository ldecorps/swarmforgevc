Feature: the TS metrics ticket-id extractor uses the BL/GH allowlist and resolves the no-hyphen prefix form

  # BL-504 (sibling of BL-503, same coordinator rule_proposal, live 2026-07-17). The shared
  # exported swarmMetrics.ts extractTicketId — reused by stageDwell.ts, ticketHoldingWindows.ts,
  # reworkObservatorySource.ts and swarmState.ts — matches `/^([A-Za-z]+-\d+)/`. Two defects:
  #   1. It requires a hyphen between the prefix and digits, so a no-hyphen task header
  #      ("bl493-fold-ticket-events") resolves to null and the ticket is omitted from every
  #      derived metric (stage-dwell, holding windows, rework observatory).
  #   2. Its prefix is an UNBOUNDED [A-Za-z]+, not the (BL|GH) allowlist the two .bb extractors
  #      use — so it OVER-MATCHES: "usable-493-x" resolves to "usable-493" and "ABL-217-x" to
  #      "ABL-217", swallowing/fabricating ids (the exact BL-217/BL-222 failure the .bb
  #      allowlist exists to prevent, latent here because this TS copy never adopted it).
  # The fix aligns this extractor with the .bb ones: adopt the (BL|GH) allowlist, make the
  # prefix hyphen optional, and CANONICALIZE the match to upper-case hyphenated BL-NNN (it
  # returns the raw match today). gitHistoryAdapter.ts has its OWN filename extractor over
  # always-canonical backlog paths and is out of scope.

  # BL-504 ts-metrics-ticket-id-01
  Scenario Outline: the extractor resolves the no-hyphen prefix form, canonicalizes it, and rejects any non-allowlisted prefix
    When a ticket id is extracted from the task header "<task>"
    Then it resolves to "<resolved>"

    Examples:
      | task                       | resolved |
      | bl493-fold-ticket-events   | BL-493   |
      | BL-493-fold-ticket-events  | BL-493   |
      | bl-493-fold-ticket-events  | BL-493   |
      | gh77-issue-seeded          | GH-77    |
      | ABL-217-glued-prefix       | NONE     |
      | usable-493-not-a-ticket    | NONE     |
      | usable493-not-a-ticket     | NONE     |

  # BL-504 ts-metrics-ticket-id-02
  Scenario: a ticket whose handoffs use the no-hyphen task form appears in the derived metrics under its canonical id
    Given a role held handoff trail for a ticket whose task header is "bl493-fold-ticket-events"
    When the stage-dwell report is computed
    Then the report includes an entry keyed by "BL-493"

# Non-behavioral gates:
#  - Scope is the SHARED exported swarmMetrics.ts extractTicketId; its consumers (stageDwell,
#    ticketHoldingWindows, reworkObservatorySource, swarmState) inherit the fix — do not add a
#    second copy in any consumer.
#  - The prefix MUST become the (BL|GH) allowlist (matching pipeline_stage_lib.bb /
#    chase_sweep_lib.bb), never an unbounded [A-Za-z]+; the "usable-493" and "ABL-217" rows are
#    the over-match regression this ticket closes, not merely a guard.
#  - Output is CANONICAL upper-case hyphenated BL-NNN regardless of input case/hyphenation.
#  - This is a TS change: the full coverage/mutation/CRAP gate applies. Mutate the COMPILED
#    out/**/*.js path, never src/**/*.ts (engineering.prompt, BL-387).
