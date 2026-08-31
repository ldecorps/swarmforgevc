Feature: BL-1319 stage-dwell and bottleneck naming key on the stage, never on a seat

  BL-983 declared that seat identity never escapes the mailbox layer, and
  BL-1040 closes that on the board and stage-map. The optimizer's own dwell
  instrument is still open: `nameBottleneck` ranks rows keyed on whatever role
  string the roles table carried, which for a non-bare seat is `coder@sonnet2`.
  So a two-seat stage reports as two unrelated stages — each row holding only
  its own seat's parcels — and the coordinator is told a SEAT is the
  bottleneck. Worse than a cosmetic label: splitting one stage's dwell across
  its seats understates that stage, so the real bottleneck can be ranked below
  a single-seat stage that is actually faster. This ticket folds seats onto
  their stage at the reporting layer, leaving the per-seat records intact
  underneath for a later ops surface to render.

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
  Scenario: the named bottleneck is a stage name, never a seat id
    Given the slowest processing belongs to the non-bare coder seat
    When the bottleneck is named
    Then the bottleneck is reported as "coder"
    And no reported stage name or bottleneck name contains an "@"

  # BL-1319 split-no-longer-understates-the-stage-03
  Scenario: a stage is not ranked below a faster one by having its dwell split
    Given the coder seats together process slower than every single-seat stage
    And neither coder seat alone processes slower than the slowest single-seat stage
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
