# mutation-stamp: sha256=29811f2580c4d229894912e03dc1869f004dc800d0dbc6d549717c87012d2958
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-30T22:34:05.101356408Z","feature_name":"A review role's forward carries work that role actually did","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1293-a-review-forward-carries-the-roles-own-work.feature","background_hash":"4c6b6778a6267dbee1ad749e7a80cd1948d93e71aa987cd13bac28af53812ee9","implementation_hash":"unknown","scenarios":[{"index":0,"name":"A forward is judged by what the role contributed, not by the commit id","scenario_hash":"d8e81fec9ce922e17412265e8498d05e790cd6bda2f1d55bfc4242c733bbe754","mutation_count":8,"result":{"Total":8,"Killed":8,"Survived":0,"Errors":0},"tested_at":"2026-08-30T22:34:01.718189823Z"}]}
# acceptance-mutation-manifest-end

Feature: A review role's forward carries work that role actually did

  BL-806's review-forward evidence gate refuses a forward whose `commit:`
  EQUALS the commit the role received — Article 4.4's "commit your
  explicit-NONE evidence (or your fix) and forward THAT commit", enforced
  structurally because BL-536 proved prompt text was not enough.

  It compares commit IDENTITY. A merge is a new commit, so a bare
  "Merge <received> into <role-branch>" passes the gate while introducing
  nothing the role authored. That is the most common commit shape in this
  swarm, and it is the shape the gate cannot see.

  BL-1269 already fixed exactly this class in the pre-QA ancestry gate, and
  the primitive it used — `merge-introduces-nothing-unique?` in
  `pre_qa_gate_gather_lib.bb` — is one file away and unused here.

  Background:
    Given a review role forwarding a parcel it received

  # BL-1293 review-forward-own-work-01
  Scenario Outline: A forward is judged by what the role contributed, not by the commit id
    Given the forwarded commit <shape>
    When the review-forward evidence gate decides
    Then the forward is <verdict>

    Examples:
      | shape                                          | verdict  |
      | is the received commit unchanged               | refused  |
      | is a merge introducing nothing of its own      | refused  |
      | carries the role's own evidence file           | allowed  |
      | carries the role's own fix                     | allowed  |

  # BL-1293 review-forward-own-work-02
  # Article 4.4: a clean sweep is a real outcome, but it must be COMMITTED.
  Scenario: An explicit no-defect sweep is a pass when it is committed
    Given a review role found no defect and committed its explicit NONE evidence
    When the review-forward evidence gate decides
    Then the forward is allowed

  # BL-1293 review-forward-own-work-03
  # The refusal has to name the missing thing, or the role cannot act on it.
  Scenario: A refusal names what the forward is missing
    Given a forward refused for carrying none of the role's own work
    When the refusal is read
    Then it names the role, the task, and the evidence the role must commit
