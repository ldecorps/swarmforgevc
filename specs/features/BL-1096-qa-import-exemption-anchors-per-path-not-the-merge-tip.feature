Feature: the QA-import exemption is decided per path, not by the incoming merge tip

  # BL-1096 (deterministic-transit-assist). BL-925 taught
  # check_pipeline_code_on_main.sh to allow a merge that only IMPORTS pipeline
  # code QA already published. It anchors that decision on the incoming merge
  # PARENT TIP: exempt only when `is_qa_ancestor.sh <MERGE_HEAD>` answers yes.
  # That holds for a single-hop-behind reconcile, where the tip IS QA's
  # landing. It stops holding once the checkout is several commits behind and
  # `origin/main`'s tip is a later bookkeeping commit — the tip is then not a
  # QA ancestor, the whole exemption is withdrawn at once, and every offending
  # path is refused even though each path's own last-touching incoming commit
  # is a QA ancestor. Measured 2026-08-23 on reconcile merge 37efb07e3: the
  # incoming tip e57ff6406 answered "no", while the pipeline paths it carried
  # last-touched at a55b5156ba and each answered "yes".
  #
  # The boundary this pins is unchanged from BL-925 — CONTENT PROVENANCE, never
  # merge-in-progress. What changes is only WHICH commit's provenance is asked
  # about: the commit that actually put this path's content there, asked per
  # path, instead of one tip standing in for all of them.
  #
  # Step handlers: specs/pipeline/steps/bl1096PerPathImportProvenanceSteps.js,
  # driving the guard against fixture repos. The <provenance> column is
  # validated against explicit KNOWN_VALUES, never passed through.

  Background:
    Given a master checkout on `main`, several commits behind an `origin/main` whose tip is a bookkeeping commit made after QA's last landing

  # BL-1096 multi-hop-import-completes-01
  Scenario: the join completes when the incoming tip is not itself a QA landing
    Given every offending pipeline path was last touched on the incoming side by a commit QA published
    When a non-QA writer completes the merge on `main`
    Then the merge commit is created
    And no pipeline path is named as refused

  # BL-1096 per-path-provenance-decides-02
  Scenario Outline: each offending path is judged on its own provenance
    Given one offending pipeline path whose incoming provenance is <provenance>
    When the commit-time guard runs
    Then that path is <outcome>

    Examples:
      | provenance                                             | outcome |
      | last touched by a commit QA published                  | allowed |
      | last touched by a commit QA never published            | refused |
      | last touched by a commit QA published and then bounced | refused |
      | absent from the incoming side's history                | refused |
      | undeterminable, the approval predicate cannot answer   | refused |

  # BL-1096 fresh-edit-still-refused-03
  Scenario: a fresh edit staged on top of a multi-hop import is still refused
    Given every offending pipeline path is importable and the writer additionally stages a new edit to one pipeline file
    When the commit-time guard runs
    Then the edited path is refused and the imported paths are not
