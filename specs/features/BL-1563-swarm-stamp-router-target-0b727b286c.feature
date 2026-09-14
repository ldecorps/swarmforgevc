Feature: BL-1563 Stamp-off review of the idle-resident-asks-the-router hotfix

  BL-848 review-only certification of landed commit 0b727b286c (2026-09-14).
  Human observation 2026-09-14: "the mono router pipeline seats are again
  rotating to coder in between each hop". After 92ecf4aea3 (BL-1557) every
  git_handoff forward hopped direct, but a seat rotated in only to consume a
  broadcast note (QA merge-up, coordinator "merge up") had no parcel to
  follow, took the BL-550 home fallback, and the chase sweep then rotated
  the resident on to the next note holder - the coder hop was back on every
  note visit. The hotfix has the task and batch dispatchers, when and only
  when the forward decision fell back to home, ask the router's own mailbox
  scoring (mono_router_rows_lib.bb, a dispatcher-side copy of handoffd.bb's
  role-mail-row) and print ROTATE_TO <that role> with reason
  router-preferred; a confirmed recipient and `rotation_after_forward home`
  stand; the coordinator, the departing role, home and an unknown role are
  never router targets; nothing actionable anywhere is still home.

  These scenarios confirm or refute what landed; none may rewrite it, and
  none writes a certify or waive decision into backlog/hotfix-ledger.yaml -
  only a recorded human decision does that.

  Background:
    Given a rotation-router pack whose home role is coder and whose roles.tsv names specifier, coder, cleaner, architect, hardender, documenter, QA and coordinator

  # BL-1563 swarm-stamp-router-target-01
  Scenario Outline: the empty-mailbox resolver lets a confirmed forward stand and asks the router only on the home fallback
    Given the departing role QA, whose forward decision is <forward-target> for reason <forward-reason>, and the router's preferred mailbox is <router>
    When the empty-mailbox target is resolved
    Then the target is <target> for reason <reason>

    Examples:
      | forward-target | forward-reason        | router       | target    | reason                |
      | architect      | forward-recipient     | hardender    | architect | forward-recipient     |
      | coder          | policy-home           | hardender    | coder     | policy-home           |
      | coder          | recipient-is-home     | hardender    | hardender | router-preferred      |
      | coder          | recipient-not-holding | hardender    | hardender | router-preferred      |
      | coder          | recipient-not-holding | none         | coder     | recipient-not-holding |
      | coder          | recipient-not-holding | coder        | coder     | recipient-not-holding |
      | coder          | recipient-not-holding | coordinator  | coder     | recipient-not-holding |
      | coder          | recipient-not-holding | QA           | coder     | recipient-not-holding |
      | coder          | recipient-not-holding | art-director | coder     | recipient-not-holding |

  # BL-1563 swarm-stamp-router-target-02
  Scenario: the real dispatchers and wrapper carry the router's answer and the hotfix's own case census is complete
    When the rotate-home shell test runs against the real ready_for_next dispatchers and wrapper
    Then it reports every check passed
    And its passing checks include cases 16 through 20, the five the hotfix added

  # BL-1563 swarm-stamp-router-target-03
  Scenario: the dispatcher-side copy of the router's scoring answers exactly what the daemon answers
    When the handoffd priority-rotate wiring shell test runs
    Then it reports every check passed
    And its source compares mono_router_rows_cli.bb against the daemon's printed target on all four fixtures A through D

  # BL-1563 swarm-stamp-router-target-04
  Scenario: a master-resident role's held work is a router target and the shared checkout is never mutated
    Given the specifier and coordinator rows share one master checkout, the specifier's role-keyed inbox holds an in_process note, and no other mailbox is actionable
    When the documenter's task dispatcher finds its mailbox empty with no parcel to follow
    Then it prints ROTATE_TO specifier for reason router-preferred
    And every mailbox file on the shared checkout is unchanged

  # BL-1563 swarm-stamp-router-target-05
  Scenario Outline: the operator CLI prints the router's target, none, or a usage error
    Given the CLI is invoked with <argument>
    When mono_router_rows_cli.bb runs
    Then it prints <output> and exits <exit>

    Examples:
      | argument                                                        | output    | exit |
      | the fixture root holding a priority-00 git_handoff at hardender | hardender | 0    |
      | the fixture root holding only a fresh note                      | none      | 0    |
      | no argument                                                     | usage     | 2    |

  # BL-1563 swarm-stamp-router-target-06
  Scenario: the stamp leaves the certification decision to the human
    When the review parcel completes
    Then the ledger row for the reviewed commit still reads "pending"
