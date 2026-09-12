Feature: BL-1549 Stamp-off review of the ephemeral consult session hotfix

  BL-848 review-only certification of landed commit 5bdf93beed (2026-09-12).
  BL-1535's chase gate correctly refuses to rotate the mono-router resident
  away from a role that is mid-parcel, but the target role's mail - often a
  question FROM the departing role - then had no live pane until the resident
  went idle. The hotfix spawns the target role's OWN roles.tsv session
  through resolve-single-role-repair on exactly that refusal, dedupes on a
  marker, and tears the session down once its pane is idle and its mailbox
  holds nothing actionable.

  These scenarios confirm or refute what landed; none may rewrite it, and
  none writes a certify or waive decision into backlog/hotfix-ledger.yaml -
  only a recorded human decision does that.

  # BL-1549 swarm-stamp-consult-session-01
  Scenario Outline: only the departing-mid-parcel refusal with a distinct, unconsulted target is consult-eligible
    Given a rotate refusal of <gate> for a target role whose session is <session> and whose consult is <consult>
    When consult eligibility is decided
    Then the decision is <eligible>

    Examples:
      | gate                 | session                | consult    | eligible     |
      | departing-mid-parcel | distinct from resident | not active | eligible     |
      | departing-mid-parcel | the resident's own     | not active | not eligible |
      | departing-mid-parcel | distinct from resident | active     | not eligible |
      | busy                 | distinct from resident | not active | not eligible |
      | cooldown             | distinct from resident | not active | not eligible |
      | already-active       | distinct from resident | not active | not eligible |

  # BL-1549 swarm-stamp-consult-session-02
  Scenario: the refusal spawns the target's own session exactly once and never touches the resident pane
    Given a mono-router resident holding a working in_process parcel and a target role with mail whose own session is absent
    When the chase attempts the rotate twice in a row
    Then the rotate is refused as departing-mid-parcel both times
    And exactly one new-session carrying the target role's launch script was issued
    And no respawn-pane was issued
    And a consult marker names the target role and the departing role

  # BL-1549 swarm-stamp-consult-session-03
  Scenario: the target role's wake reaches the consult session, not the resident
    Given the target role's configured session exists alongside the resident session
    When the wake session for the target role is resolved
    Then the wake goes to the target role's configured session

  # BL-1549 swarm-stamp-consult-session-04
  Scenario Outline: a consult session is torn down only when idle with nothing actionable
    Given a consult marker for a role whose session is <session>, whose pane is <pane>, and whose mailbox is <mailbox>
    When the consult teardown sweep runs
    Then the session is <session outcome>
    And the marker is <marker outcome>

    Examples:
      | session | pane | mailbox           | session outcome | marker outcome |
      | live    | idle | empty             | killed          | cleared        |
      | live    | busy | empty             | kept            | kept           |
      | live    | idle | holding a parcel  | kept            | kept           |
      | gone    | idle | empty             | not killed      | cleared        |

  # BL-1549 swarm-stamp-consult-session-05
  Scenario: the existing refusal checks are unchanged by the spawn side effect
    Given the departing-mid-parcel gate fixture with the target session present
    When the chase attempts the rotate
    Then the rotate is refused as departing-mid-parcel with its telemetry row
    And no new-session was issued
    And no respawn-pane was issued

  # BL-1549 swarm-stamp-consult-session-06
  Scenario: the stamp leaves the certification decision to the human
    When the review parcel completes
    Then the ledger row for the reviewed commit still reads "pending"
