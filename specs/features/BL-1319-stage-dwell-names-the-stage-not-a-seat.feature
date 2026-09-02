Feature: BL-1319 stage-dwell and bottleneck naming key on the stage, never on a seat

  BL-983 declared that seat identity never escapes the mailbox layer, and
  BL-1040 closes that on the board and stage-map. The optimizer's own dwell
  instrument is still open, though not in the way this file first described.
  `computeStageDwellReportForRoles` selects rows with
  `PIPELINE_ORDER.includes(r.role)`, and `PIPELINE_ORDER` holds bare stage
  names only. A non-bare seat such as `coder@sonnet2` fails that membership
  test, so it is dropped BEFORE its mailbox is read: its parcels never become
  records at all. A two-seat stage is therefore reported on its bare seat
  alone, understated by OMISSION rather than split across two rows, and the
  real bottleneck can still be ranked below a single-seat stage that is
  actually faster. This ticket makes stage membership and row keying happen on
  the STAGE, so every seat of a stage is read and folded into that stage's one
  row, leaving the per-seat records intact underneath for a later ops surface
  to render.

  Background:
    Given a swarm whose coder stage runs the seats "coder" and "coder@sonnet2"
    And every other stage runs exactly one bare seat

  # BL-1319 seats-fold-into-one-stage-row-01
  Scenario: the two seats of one stage report as a single stage row
    Given each coder seat has completed parcels of its own
    When the stage-dwell report is computed
    Then exactly one dwell row exists for the coder stage
    And that row accounts for the parcels of both seats

  # BL-1319 bottleneck-never-names-a-seat-02
  # A regression guard on the FIX, not a demonstration of the defect: today no
  # seat-keyed row can exist at all, so this passes before the change. It
  # exists because an implementation that starts reading seat mailboxes could
  # key the new row on the seat id. Retire it only with invariant 1.
  Scenario: the named bottleneck is a stage name, never a seat id
    Given the slowest processing belongs to the non-bare coder seat
    When the bottleneck is named
    Then the bottleneck is reported as "coder"
    And no reported stage name or bottleneck name contains an "@"

  # BL-1319 omission-no-longer-understates-the-stage-03
  # Corrected 2026-09-02. The original asked for a fixture that cannot exist:
  # ranking is on MEDIAN processing, and a median over the union of two sets
  # each with median <= X is itself <= X, so "neither seat alone slower than X"
  # and "both together slower than X" are mutually exclusive. The satisfiable
  # form is the one the real defect produces: the BARE seat is fast, the
  # dropped seat is slow, and only reading both moves the stage to the top.
  Scenario: a stage is not ranked below a faster one by having a seat's parcels omitted
    Given the bare coder seat alone processes faster than the slowest single-seat stage
    And the parcels of both coder seats together process slower than every single-seat stage
    When the bottleneck is named
    Then the bottleneck is reported as "coder"

  # BL-1319 per-seat-records-survive-the-fold-04
  Scenario: folding is a reporting concern and does not discard seat detail
    Given each coder seat has completed parcels of its own
    When the stage-dwell report is computed
    Then the underlying dwell records still attribute each parcel to the seat that worked it

  # BL-1319 single-seat-swarm-unchanged-05
  Scenario: a swarm with only bare seats reports exactly as it did before
    Given the coder stage runs only the bare seat "coder"
    When the stage-dwell report is computed
    Then the report is identical to the pre-fold output for the same parcels
