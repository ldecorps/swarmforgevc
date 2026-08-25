Feature: a deferred hardening gate leaves a durable debt record

  # BL-942 builds the RECORDING half of the office-hours mutation bypass. The
  # rule promises the full pass "still runs, just against a quiet host", but
  # nothing records what was skipped, so no later pass can discharge it. These
  # scenarios pin the record itself; choosing and building the drain is a
  # separate ticket and deliberately not gated here.

  Background:
    Given a hardening pass on a parcel with a wired mutation target

  # BL-942 deferral-records-a-debt-row-01
  Scenario Outline: a gate that could not run leaves a row naming what was skipped
    Given the <gate> gate is blocked by host load above the busy threshold
    When the hardening pass completes and forwards the parcel
    Then the debt ledger holds a row for that parcel and gate
    And the row names the file set that was skipped
    And the row records the load measurement that justified the skip

    Examples:
      | gate     |
      | mutation |
      | CRAP     |

  # BL-942 gate-that-ran-records-nothing-02
  Scenario: a gate that ran leaves no debt row
    Given the mutation gate runs to completion against a quiet host
    When the hardening pass completes and forwards the parcel
    Then the debt ledger holds no row for that parcel

  # BL-942 repeat-deferral-is-idempotent-03
  Scenario: deferring the same file set twice does not duplicate the debt
    Given the debt ledger already holds a mutation row for a file set
    When another hardening pass defers the mutation gate for that same file set
    Then the debt ledger still holds exactly one row for that file set

  # BL-942 outstanding-debt-is-machine-readable-04
  Scenario: the outstanding debt can be read back without parsing evidence prose
    Given the debt ledger holds rows from earlier deferrals
    When the outstanding debt is read through the ledger's own reader
    Then each parcel and its skipped file set are returned
    And no evidence markdown file is consulted to produce that answer
