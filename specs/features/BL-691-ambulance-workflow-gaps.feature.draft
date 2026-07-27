Feature: the ambulance moves the patient and nothing else

  BL-655 shipped ambulance mode and its first live run moved everything
  except the patient. A parcel sent synchronously was delivered despite the
  hold; the patient's own parcel then waited over an hour in a role inbox
  because the resident was busy elsewhere; and the ambulance had been engaged
  on a ticket sitting in paused, where nothing could move at all.

  BL-655's twelve scenarios still hold. These add the three cases its wiring
  missed.

  Background:
    Given a swarm with ambulance mode available

  # BL-691 ambulance-gaps-01
  Scenario: a synchronous send holds a non-patient parcel in the outbox
    Given the ambulance is engaged for the patient
    When a role sends a parcel for another ticket without the daemon delivering it
    Then the parcel stays in the sender's outbox
    And the recipient's inbox does not hold it

  # BL-691 ambulance-gaps-02
  Scenario: the held parcel is delivered intact once the ambulance releases
    Given the ambulance is engaged for the patient
    And a parcel for another ticket was sent synchronously
    When the ambulance releases
    Then the parcel is delivered to the recipient's inbox byte-identical

  # BL-691 ambulance-gaps-03
  Scenario Outline: every path that moves a parcel consults the same hold
    Given the ambulance is engaged for the patient
    When a parcel for another ticket reaches the <mover>
    Then the parcel does not advance

    Examples:
      | mover           |
      | synchronous send |
      | daemon delivery  |
      | inbox dequeue    |

  # BL-691 ambulance-gaps-04
  Scenario: a busy resident does not defer the patient's parcel
    Given the ambulance is engaged for the patient
    And the patient's parcel waits in the QA inbox
    And the resident is busy at coder
    When the chase sweep decides where the resident belongs
    Then the resident rotates to QA

  # BL-691 ambulance-gaps-05
  Scenario: the patient outranks non-patient mail that arrived later
    Given the ambulance is engaged for the patient
    And the patient's parcel waits in the QA inbox
    And a newer parcel for another ticket waits in the cleaner inbox
    When the chase sweep decides where the resident belongs
    Then the resident rotates to QA

  # BL-691 ambulance-gaps-06
  Scenario: with no patient parcel waiting, the busy resident is left alone
    Given the ambulance is engaged for the patient
    And no inbox holds a parcel for the patient
    And the resident is busy at coder
    When the chase sweep decides where the resident belongs
    Then the resident is not rotated

  # BL-691 ambulance-gaps-07
  Scenario Outline: engaging on a patient that cannot move is refused
    Given a ticket sitting in <folder>
    When the operator engages the ambulance for it
    Then the engage is refused
    And the refusal names <folder>
    And the ambulance stays disengaged

    Examples:
      | folder  |
      | paused  |
      | hold    |
      | done    |

  # BL-691 ambulance-gaps-08
  Scenario: engaging on an active patient still succeeds
    Given a ticket sitting in active
    When the operator engages the ambulance for it
    Then the ambulance is engaged for that ticket

  # BL-691 ambulance-gaps-09
  Scenario: the connected run — the patient reaches QA and is claimed once
    Given a ticket sitting in active
    And a parcel for another ticket waiting to be sent
    When the operator engages the ambulance for it
    And the patient's parcel is forwarded to QA
    Then the other ticket's parcel never leaves its outbox
    And the resident rotates to QA
    And the resident claims the patient's parcel
    And no role works the patient's parcel twice
