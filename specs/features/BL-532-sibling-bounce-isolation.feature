Feature: a sibling's defect does not re-queue a clean parcel

  # BL-532 (BL-512 audit BL-FIX-005): a batch role legitimately produces one commit that
  # satisfies several tickets (Article 2.6). On 2026-07-17 that commit carried BL-469's icon
  # collision, so BL-475, BL-477 and BL-465 — each verified clean on its own — were bounced
  # as `integration` "blocked by the shared failure". When later parcels for the same tickets
  # arrived on the same tree, QA spent a second full verification pass and wrote a second
  # evidence file per ticket, each recording that nothing had changed. Those bounces also
  # counted against the producing role in the BL-454 tally, inflating it with defects that
  # role never introduced. A parcel with no failing check of its own is therefore DEFERRED
  # pending the blocker — never re-queued for rework, never recorded as a bounce.

  Background:
    Given a batch commit that satisfies several tickets and carries one ticket's failing check

  # BL-532 sibling-without-own-proof-is-deferred-01
  Scenario: a clean sibling on a contaminated tree is deferred rather than bounced
    Given ticket A fails a check on the shared commit
    And ticket B rides the same commit with no failing check of its own
    When QA dispositions ticket B
    Then QA is told ticket B is deferred pending ticket A
    And no rework handoff is sent for ticket B

  # BL-532 deferral-is-not-a-qa-bounce-02
  Scenario: a deferral is not counted as a QA bounce against the producing role
    Given ticket A fails a check on the shared commit
    And ticket B rides the same commit with no failing check of its own
    When QA dispositions ticket B
    Then the QA-bounce tally for the producing role is unchanged

  # BL-532 repeat-arrival-reports-the-open-blocker-03
  Scenario: a later parcel for a deferred ticket is told its blocker instead of being verified
    Given ticket B has an open deferral pending ticket A
    When QA asks for ticket B's disposition at a later commit
    Then QA is told ticket B is deferred pending ticket A
    And QA is given the blocker's failing command to re-run

  # BL-532 cleared-blocker-resumes-verification-04
  Scenario: clearing the blocker returns the deferred ticket to normal verification
    Given ticket B has an open deferral pending ticket A
    When QA clears ticket B's deferral pending ticket A at a later commit
    Then QA is told ticket B is ready to verify

  # BL-532 own-defect-still-bounces-05
  Scenario Outline: an open deferral suppresses only the blocker's own failure signature
    Given ticket B has an open deferral pending ticket A
    When QA observes a failure on ticket B with <signature relation> the open deferral's signature
    Then QA is told ticket B is <disposition>

    Examples:
      | signature relation         | disposition               |
      | the same signature as      | deferred pending ticket A |
      | a different signature from | bounced for its own defect |

  # BL-532 every-blocker-must-clear-06
  Scenario: a ticket blocked by two siblings stays deferred until both clear
    Given ticket B has open deferrals pending ticket A and ticket D
    When QA clears ticket B's deferral pending ticket A at a later commit
    Then QA is told ticket B is deferred pending ticket D
