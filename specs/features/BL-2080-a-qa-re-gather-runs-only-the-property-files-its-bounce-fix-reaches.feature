Feature: A QA re-gather runs only the property files its bounce fix reaches
  QA's gather runs the whole property lane on every gather, and BL-1877
  keeps it there on purpose: a commit's own hook runs only the property
  files its change reaches, and QA's whole-lane run once per parcel is the
  backstop. On 2026-10-07 the lane took 389-1314 s of each of QA's 16
  gathers, 75-90% of the gather. Four of them were re-gathers of a bounced
  ticket whose earlier gather had run the whole lane green at a commit the
  fix descends from, and they paid 2912 s of lane again for small fixes.
  A re-gather now runs only the property files the change since that green
  whole-lane commit reaches. A changed file outside extension/src reaches
  the property files that name it, or name the directory it sits in.
  Anything the reach cannot place runs the whole lane.

  Background:
    Given a fixture repository holding a ticket in backlog/active

  # BL-2080 regather-runs-reached-files-01
  Scenario Outline: a re-gather after a green whole-lane run runs only the property files the change reaches
    Given QA's gather ran this ticket's whole property lane green at an earlier commit
    And a fix commit descending from that commit changes <changed>
    When QA gathers the fix commit
    Then the properties row runs only <files>
    And the properties row names the earlier commit
    And the properties row writes no whole-lane duration record

    Examples:
      | changed                                                          | files                     |
      | one extension/src module that two property files reach           | those two property files  |
      | a swarmforge/scripts file that one property file names           | that property file        |
      | a backlog file that one property file reads by name              | that property file        |
      | a feature file while one property file names the features folder | that property file        |
      | only backlog/evidence files that no property file names          | no property file          |

  # BL-2080 regather-falls-back-to-whole-lane-02
  Scenario Outline: a gather the reach cannot place runs the whole lane
    Given <condition>
    When QA gathers the fix commit
    Then the properties row runs the whole lane

    Examples:
      | condition                                                                                              |
      | no earlier gather of this ticket ran the whole property lane                                           |
      | QA's gather ran this ticket's whole property lane green at a commit the fix commit does not descend from |
      | QA's gather ran this ticket's whole property lane red at an earlier commit                             |
      | the reach selector prints ALL for the change since the green whole-lane commit                         |
      | the reach selector exits non-zero for the change since the green whole-lane commit                     |
