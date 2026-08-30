Feature: A review role's forward adds evidence that role authored

  BL-806's gate refused a forward whose `commit:` equalled the received one.
  BL-1293 widened it to refuse a merge that introduces nothing over its
  parents. Both ask what the COMMIT looks like; neither asks whether the ROLE
  did anything.

  The forward that prompted both — the architect's `b7d22b9ee3` on BL-1224 —
  passes both. It resolved a real conflict in `specs/pipeline/steps/index.js`,
  so it does introduce content of its own, while carrying no BL-1224 review
  output at all. Only a human-authored QA bounce, noticing a missing evidence
  file, caught it.

  Article 4.4 already names the artifact: one evidence file per review pass,
  items D1..Dn, and a clean sweep records an explicit NONE and COMMITS it. So
  the fact to check is not how the diff looks but whether the forward added
  that file for the task being forwarded.

  Background:
    Given a review role forwarding a parcel it received for a task

  # BL-1307 review-forward-adds-own-evidence-01
  Scenario Outline: A forward is judged by the evidence the role committed for this task
    Given the commits from received to forwarded <shape>
    When the review-forward evidence gate decides
    Then the forward is <verdict>

    Examples:
      | shape                                                 | verdict |
      | add an evidence file naming this task                 | allowed |
      | add an explicit committed NONE for this task          | allowed |
      | resolve a conflict and add no evidence for this task  | refused |
      | add only an evidence file naming a different task     | refused |

  # BL-1307 review-forward-adds-own-evidence-02
  # The commit neither earlier gate can reach: it introduces content of its
  # own, so BL-1293's contribution primitive passes it, yet the architect
  # authored no review output for the task it was forwarding.
  Scenario: The BL-1224 architect forward is refused
    Given the architect's forward resolved a conflict but committed no BL-1224 evidence
    When the review-forward evidence gate decides
    Then the forward is refused
    And the refusal names the role, the task, and the evidence file to commit

  # BL-1307 review-forward-adds-own-evidence-03
  # BL-806's standing constraint, and the reason this gate is safe to widen:
  # a gate that cannot read its own inputs must never stall a legitimate send.
  Scenario: A forward the gate cannot evaluate is left alone
    Given the gate cannot read what the forward added
    When the review-forward evidence gate decides
    Then the forward is allowed
