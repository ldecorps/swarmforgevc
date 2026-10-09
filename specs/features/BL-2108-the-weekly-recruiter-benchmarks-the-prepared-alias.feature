Feature: BL-2108 The weekly recruiter benchmarks the prepared alias

  recruiter_weekly.sh discovers one Hugging Face candidate, pulls it,
  registers it with the Model Steward, runs the coder and compliance
  batteries, and lets the steward's certify gate decide. Since 1e64496d93
  (a Cursor agent's commit, owned here) it prepares the pulled tag through
  local_model_prepare_cli.bb right after the pull, so the batteries and the
  gate see the model behind a Modelfile with thinking off, as the live seats
  run it, instead of the bare tag. The recruiter still only offers: it never
  staffs a seat or edits a pack.

  Background:
    Given a fixture project whose recruiter scripts run against fakes for discovery, ollama, the batteries and the steward
    And discovery offers one candidate pulled as "hf.co/org/repo:Q4_K_M" and aliased "cand"

  # BL-2108 recruiter-prepared-alias-01
  Scenario: registration, batteries and certify all name the prepared alias
    Given the steward's certify gate passes
    When the weekly recruiter runs
    Then it prepared "hf.co/org/repo:Q4_K_M" as "prepared-cand"
    And the steward was asked to register "local/prepared-cand"
    And the coder battery ran against "prepared-cand"
    And the steward was asked to certify "local/prepared-cand"
    And the run finished "certified"

  # BL-2108 recruiter-prepared-alias-02
  Scenario: a prepare that fails ends the run before anything is registered
    Given preparing the pulled tag fails
    When the weekly recruiter runs
    Then the run finished "prepare-failed"
    And the steward was asked to register nothing

  # BL-2108 recruiter-prepared-alias-03
  Scenario: a refused candidate's cleanup removes only what this run made
    Given the steward's certify gate refuses
    When the weekly recruiter runs
    Then the run finished "refused"
    And ollama was asked to remove exactly "prepared-cand", "cand" and "hf.co/org/repo:Q4_K_M"
