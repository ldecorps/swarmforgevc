# mutation-stamp: sha256=96382055d8d1832109a0f0a2ce1bdfe2955e5a79d94d4168beb34d138e1effe2
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-29T01:52:54.279456810Z","feature_name":"the property-suite allowlist gate recognises every allowlisted red, not just a lone one","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1234-property-allowlist-gate-recognises-every-red.feature","background_hash":"6763b950886b6cfa7fe000425c438da24b93ad5578b00ee0a6d338470a2ac0b0","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a run whose failures are all allowlisted is allowed, whatever the count","scenario_hash":"6309bcff6f5496a7e3c9c09022fc253e6d6c5a69822f931741a82d3607c5d038","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-29T01:52:54.279456810Z"}]}
# acceptance-mutation-manifest-end

Feature: the property-suite allowlist gate recognises every allowlisted red, not just a lone one

  # BL-1234 (epic swarm-reliability). BL-1175 lets a commit through when every
  # red property test is on the standing allowlist. The verdict is correct for
  # exactly one failing file and wrong for two or more, so the feature has
  # never worked for the case it was built for.

  Background:
    Given a property suite run that failed
    And a standing-red allowlist naming files by path

  # BL-1234 every-allowlisted-red-is-recognised-01
  Scenario Outline: a run whose failures are all allowlisted is allowed, whatever the count
    Given <failing_count> failing files, every one of them named in the allowlist
    When the property-suite guard evaluates the run
    Then the commit is allowed

    Examples:
      | failing_count |
      | one           |
      | two           |
      | five          |

  # BL-1234 unlisted-file-is-named-alone-02
  Scenario: an unlisted file among allowlisted ones refuses, and only it is named
    Given three failing files, two named in the allowlist and one not
    When the property-suite guard evaluates the run
    Then the commit is refused
    And the refusal names the unlisted file and no other path
