Feature: Model Steward evaluate ingests captured benchmark evidence into the registry

  # BL-556 (BL-547 Slice 2, drained from
  # BL-547-model-steward-slices-2-3.feature.draft 2026-07-22): Slice 1 certifies
  # models manually with an empty gate list. Slice 2 adds `model-steward evaluate`,
  # which INGESTS a captured recruiter scorecard (and optional bake-off run) JSON
  # artifact and turns it into a capability-registry entry, an evidence-pointed
  # role-matrix ranking, and an evidence-backed certification report.
  #
  # PIN (human ruling 2026-07-22): evaluate is a PURE INGEST of a JSON artifact
  # path — it does not spawn the compliance battery, recruiter, or bake-off run
  # itself (recruiter-run.ts / bakeoff-run.ts print to stdout; a separate capture
  # step writes the file). See BL-556 ticket approval_context fork 1.

  Background:
    Given the Model Steward registry is initialised
    And a captured recruiter scorecard artifact exists for model "winner-model" role "coder"

  # BL-556 evaluate-ingests-recruiter-scorecard-01
  Scenario: evaluate ingests a captured recruiter scorecard into the capability registry
    When model-steward evaluate is run for "winner-model" role "coder" with that scorecard
    Then the capability registry entry for "winner-model" is updated from the scorecard dimensions
    And the role recommendation matrix entry for "coder" carries the scorecard id as its evidence pointer

  # BL-556 evaluate-writes-evidence-backed-report-02
  Scenario: evaluate produces a certification report whose gates come from the ingested evidence
    When model-steward evaluate is run for "winner-model" role "coder" with that scorecard
    Then a certification report artifact is recorded with non-empty gate results
    And the certification report references the scorecard id

  # BL-556 evaluate-ingests-bakeoff-03
  Scenario: evaluate ingests an optional bake-off run artifact alongside the scorecard
    Given a captured bake-off run artifact for model "winner-model"
    When model-steward evaluate is run for "winner-model" role "coder" with the scorecard and bake-off run
    Then the capability registry includes bake-off-derived scores
    And the certification report references the bake-off run id

  # BL-556 evaluate-report-regression-diff-04
  Scenario: re-evaluating a model records a regression diff against its prior certification report
    Given "winner-model" already has a prior certification report
    When model-steward evaluate is run again with a scorecard showing a gate below its floor
    Then the new certification report records which gate regressed pass to fail
    And the regressed gate is reported to the operator

  # BL-556 evaluate-scripted-decertify-05
  Scenario: a scripted decertify trigger fires when an evaluate ingest shows a regression
    Given "winner-model" is currently certified with a prior passing gate
    When model-steward evaluate is run with the decertify-on-regression flag and a regressed scorecard
    Then the model status becomes "candidate" or "deprecated"
    And the certification report records the regression reason

  # BL-556 evaluate-pure-ingest-no-subprocess-06
  Scenario: evaluate reads only the artifact file and never runs the battery itself
    Given a captured recruiter scorecard artifact on disk and no running compliance battery
    When model-steward evaluate is run for "winner-model" role "coder" with that scorecard
    Then the capability registry is updated solely from the artifact file
    And no compliance battery or recruiter subprocess is invoked
