# mutation-stamp: sha256=74ff4c3e19288f07b4da7f8bdde802e3fe2b958f0e1d500cd2b91bba4a4846b5
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T12:37:51.865027189Z","feature_name":"BL-972 pre-QA gate blocks on dropped-work evidence, not subject mentions","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-972-pre-qa-gate-blocks-on-evidence-not-subject-mentions.feature","background_hash":"efe650b79a032b719ba012721880b810cdc33611fd76735a8f0c4e06c109b36e","implementation_hash":"unknown","scenarios":[{"index":0,"name":"blocking requires path evidence, and abandoned_commits always exempts","scenario_hash":"20bd45cf5563f024ad71ab9f8653524006934015ab181421a0065dd5763e0d26","mutation_count":9,"result":{"Total":9,"Killed":9,"Survived":0,"Errors":0},"tested_at":"2026-08-24T12:37:51.865027189Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-972 pre-QA gate blocks on dropped-work evidence, not subject mentions

  The pre-QA gate's ancestry check must block a documenter-to-QA forward only
  on EVIDENCE that a non-ancestor commit carries the ticket's work (touched
  paths overlapping the parcel, or diff content), never because the ticket id
  merely appears in a commit's subject line. A subject-only match surfaces as
  a warning for attention; it does not block. Reverts, bookkeeping records,
  and cross-references name tickets whose content they deliberately exclude -
  today each such commit on any role branch blocks that ticket's forward.

  Background:
    Given a ticket "BL-900" whose cited parcel commit touches "extension/src/swarm/foo.ts" and "specs/features/BL-900-x.feature"
    And a role branch holds a commit "aaaaaaaaaa" that is not an ancestor of the cited commit, main, or origin/main
    And commit "aaaaaaaaaa" names "BL-900" in its subject line

  # BL-972 pre-qa-gate-blocks-on-evidence-not-subject-mentions-01
  Scenario Outline: blocking requires path evidence, and abandoned_commits always exempts
    Given commit "aaaaaaaaaa" touches only "<touched>"
    And the ticket's abandoned_commits listing for "aaaaaaaaaa" is <abandoned>
    When the pre-QA gate evaluates the forward for "BL-900"
    Then the gate's ancestry verdict for commit "aaaaaaaaaa" is "<verdict>"

    Examples:
      | touched                    | abandoned | verdict          |
      | Extension/src/swarm/foo.ts | absent    | warning-no-block |
      | extension/src/swarm/foo.ts | absent    | block            |
      | extension/src/swarm/foo.ts | present   | exempt-no-block  |
