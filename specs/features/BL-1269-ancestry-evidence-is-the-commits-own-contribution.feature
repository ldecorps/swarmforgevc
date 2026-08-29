Feature: pre-QA ancestry evidence is a candidate commit's own contribution, not its parents'

  # BL-1269 (epic swarm-reliability; incidents BL-1249 and BL-1238,
  # 2026-08-29): BL-972 made the ancestry check block only on PATH EVIDENCE,
  # downgrading a subject-only match to a warning. For merge commits that
  # evidence is computed by pre_qa_gate_gather_lib.bb's commit-touched-paths
  # with `git diff-tree -r --name-only -m`, which lists EACH PARENT's
  # contribution — so a routine "merge main into <branch>" commit is credited
  # with the whole main-side changeset. Measured on 559d9bd19a: 104 paths
  # under -m, 4 under the combined diff (--cc) that is the merge's own
  # contribution. Any such merge whose subject happens to name a ticket id
  # therefore overlaps almost any parcel and always blocks. The same file
  # already uses --cc correctly in merge-introduces-nothing-unique?.
  #
  # The demanded remedy is not available: merging the named park-sweep commit
  # deletes six other tickets' active YAML, which the BL-1242 merge-deletion
  # guard refuses. The parcel holder can then neither forward, merge, nor
  # bounce. Evidence:
  # backlog/evidence/BL-1249-expeditor-restart-honours-the-operator-pause-marker-pre-qa-gate-20260829-documenter.md
  # backlog/evidence/BL-1238-agent-idle-clear-honours-fullness-threshold-bounce-20260829-documenter.md

  Background:
    Given the pre-QA ancestry check is in force
    And a candidate commit on a role branch whose subject names the ticket

  # BL-1269 evidence-is-the-commits-own-contribution-01
  Scenario Outline: a candidate's blocking evidence is only what it introduced itself
    Given the candidate is "<candidate>"
    And the parcel path appears in "<origin>"
    When the pre-QA gate evaluates the forward
    Then the ancestry verdict is "<verdict>"

    Examples:
      | candidate                  | origin                            | verdict |
      | a merge of main into a branch | a parent's contribution only    | warning |
      | a merge of main into a branch | the merge's own combined diff   | finding |
      | an ordinary single-parent commit | its own diff                 | finding |

  # BL-1269 warning-still-names-the-commit-02
  Scenario: a downgraded candidate is still reported, not silently dropped
    Given a merge of main into a branch whose only overlap comes from a parent's contribution
    When the pre-QA gate evaluates the forward
    Then the forward is allowed to proceed
    And a warning names that commit and its branch

  # BL-1269 never-demand-a-refused-merge-03
  Scenario: the gate never blocks on a commit whose merge another guard refuses
    Given a candidate park-sweep commit whose merge deletes another ticket's active YAML without naming it
    And the merge-deletion guard would refuse that merge
    When the pre-QA gate evaluates the forward
    Then the ancestry verdict is warning
    And the forward is allowed to proceed

  # BL-1269 recorded-incident-no-longer-blocks-04
  Scenario: the recorded BL-1249 forward proceeds through the real handoff path
    Given a fixture reproducing the BL-1249 refusal with the park-sweep commit on a role branch
    When the documenter's forward is sent through swarm_handoff.sh against that fixture
    Then the forward is not refused for ancestry
    And no merge of the park-sweep commit was required to achieve it
