Feature: BL-1428 Every standing red names an open owner

  A standing red is a test that fails on main. On 2026-09-05 the repository
  carried twenty red property files and seven red unit files. Twenty-five
  property rows sat in the property-suite allowlist saying "tracked under
  BL-1175 pending fix" with BL-1175 closed, five of them for tests that had
  since gone green; the unit reds had no list at all; the owners that did
  exist were paused medium and low defects a week old, outside the expedite
  lane; and two reds had no owner anywhere. Thirty-five evidence files that
  day said "pre-existing" and moved on. Human, 2026-09-05, verbatim: "we
  should not sweep failing tests under the carpet". Human, 2026-08-05,
  verbatim (BL-816, superseded here): "Surface the meta-defect: QA/hardener/
  coder parcels that observe a red `npm test` and proceed with 'unrelated /
  environmental, not bouncing' leave the safety signal broken."

  This feature is a standing-red register: one CLI reads every place a
  tolerated red is recorded (the property allowlist, the hardening-debt
  ledger, and a new register for the other lanes) and reports each red with
  its owner, first-seen date and age, naming as unowned any row whose ticket
  is closed or absent; a cheap-tier commit guard refuses a commit that adds
  or changes a row without an open ticket; and rows that pre-exist a commit
  never refuse it, because they are the throttle's signal (BL-1429), not the
  committer's fault. Every scenario but the last runs against a fixture root
  under a temporary directory; the last reads the parcel's own tree, a
  read-only live-tree read justified because the register at this commit is
  the contract.

  Background:
    Given a fixture root with a property allowlist, a hardening-debt ledger, a standing-red register and a backlog holding both open and closed tickets

  # BL-1428 the-register-names-every-red-and-its-owner-01
  Scenario: the register CLI reports every red with its lane, owner and age
    When the standing-red register CLI reads the fixture root
    Then every allowlist, ledger and register row appears once with its lane, file, ticket and first-seen date
    And a row whose ticket is closed or absent is reported as unowned
    And the report carries the total count and the oldest age in days

  # BL-1428 a-touched-row-must-name-an-open-ticket-02
  Scenario Outline: a commit that adds or changes a register row is judged by the ticket the row names
    Given the commit stages a register row for a red test naming <ticket>
    When check_standing_red_register.sh runs in that repository
    Then the guard <verdict>

    Examples:
      | ticket                            | verdict                                      |
      | a ticket open in backlog/paused   | exits 0 with no refusal                      |
      | a ticket open in backlog/active   | exits 0 with no refusal                      |
      | a ticket already in backlog/done  | refuses naming the row and the closed ticket |
      | no ticket at all                  | refuses naming the row                       |

  # BL-1428 pre-existing-rows-never-refuse-03
  Scenario: rows the commit did not touch never refuse it
    Given the register already holds a row naming a closed ticket committed earlier
    And the commit stages a change that touches no register source
    When check_standing_red_register.sh runs in that repository
    Then the guard exits 0 with no refusal

  # BL-1428 the-live-register-is-owned-04
  Scenario: every row in the live register names a ticket that is open
    When each ticket named in backlog/standing-reds.tsv is looked up under backlog/paused and backlog/active
    Then every one of them is found
