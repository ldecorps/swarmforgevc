Feature: Coordinator-owned ticket lifecycle ledger

  # BL-819 (slice 1 of BL-818). One durable append-only JSONL per shift under
  # .swarmforge/lean/, plus a per-ticket snapshot folded from it, recording a
  # ticket's stages, dwell, bounces, skips, stalls and close outcome. Every
  # field is composed from an instrument that already ships — handoff audit
  # headers, stage-dwell-report, record-bounce/bounce_history,
  # required_stages/stage_skip_reasons, handoffd chase telemetry, and the
  # backlog folder transition. The coordinator records and reports only; it
  # gains no new power over promotion or gating.
  #
  # Step handlers: specs/pipeline/steps/bl819TicketLifecycleLedgerSteps.js,
  # driving the real compiled lean-ledger-record.js CLI and
  # leanLedgerStore.ts/leanLedgerCompose.ts against fixture repos.

  Background:
    Given a coordinator with a lean ledger enabled for the current shift

  # BL-819 stage-transition-appended-01
  Scenario: entering and leaving a stage appends a dwell record
    Given a ticket that enters the coder stage and later leaves it
    When the coordinator records that ticket's lifecycle
    Then the ledger holds one entry for the stage entry and one for the stage exit
    And the entry carries the stage name, the parcel id, and the audit timestamps it was derived from
    And the ticket's dwell in that stage is derivable from those two entries alone

  # BL-819 bounce-recorded-with-blame-and-class-02
  Scenario: a bounce is recorded with its blamed role, class, and evidence pointer
    Given a ticket bounced by <bouncing role> blaming <blamed role> with class <class>
    When the coordinator records that ticket's lifecycle
    Then the ledger holds a bounce entry naming that bouncing role, blamed role, and class
    And the entry points at the bounce evidence file rather than copying its text

    Examples:
      | bouncing role | blamed role | class                |
      | QA            | coder       | behavior             |
      | architect     | coder       | invariant-unencoded  |
      | documenter    | documenter  | spec-gap             |

  # BL-819 skipped-stage-records-declared-reason-03
  Scenario: a skipped stage records the reason the ticket declared
    Given a ticket whose required_stages omits the cleaner
    And whose stage_skip_reasons explains why the cleaner was skipped
    When the coordinator records that ticket's lifecycle
    Then the ledger marks the cleaner as skipped for that ticket
    And the recorded skip reason is the one the ticket declared

  # BL-819 close-outcome-appended-04
  Scenario: closing a ticket appends its close outcome
    Given a ticket that QA approved and the coordinator moved to done
    When the coordinator records that ticket's lifecycle
    Then the ledger holds a close entry naming the approved commit and the destination folder
    And the ticket's full path through the pipeline is reconstructable from the ledger alone

  # BL-819 idempotent-under-replay-05
  Scenario: appending the same event twice changes nothing
    Given a lifecycle event already recorded in the ledger
    When the same event is recorded again after a hook re-run or a daemon restart
    Then the ledger is byte-identical to before the second append
    And the per-ticket snapshot is unchanged

  # BL-819 snapshot-is-a-pure-fold-06
  Scenario: the per-ticket snapshot is a fold of the ledger, never an independent writer
    Given a ticket with several lifecycle entries in the ledger
    When the per-ticket snapshot is rebuilt from the ledger from scratch
    Then the rebuilt snapshot equals the stored snapshot
    And discarding the snapshot loses no information that the ledger does not still hold

  # BL-819 unsourced-field-is-absent-not-invented-07
  Scenario: a field with no existing instrument is absent rather than inferred
    Given a lifecycle aspect for which no shipped instrument records a value
    When the coordinator records that ticket's lifecycle
    Then that field is absent from the ledger entry
    And no placeholder, estimate, or narrated value is written in its place

  # BL-819 stall-and-chase-recorded-08
  Scenario: a stall and its chase are recorded as lifecycle events
    Given a parcel that stalled long enough for handoffd to chase it
    When the coordinator records that ticket's lifecycle
    Then the ledger holds a stall entry and a chase entry for that parcel
    And each carries the timestamp it was observed at

  # BL-819 shift-scoped-ledger-rolls-over-09
  Scenario: the ledger is scoped to a shift and rolls over cleanly
    Given a ledger holding entries for the current shift
    When a new shift begins
    Then new entries are appended to the new shift's ledger
    And the previous shift's ledger is left intact and readable

  # BL-819 coordinator-gains-no-new-power-10
  Scenario: recording the ledger grants the coordinator no new authority
    Given the coordinator has recorded a full shift of lifecycle data
    When it acts on that data
    Then it may only report it or use powers it already held
    And it authors no domain spec and edits no constitution article
