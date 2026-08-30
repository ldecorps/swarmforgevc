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
