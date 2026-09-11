Feature: BL-1544 An ambiguous commit subject never silently excludes a path

  own-paths credits each delivered path from the subjects of the commits
  that touched it in the parcel's range, through pipeline_stage_lib's
  first-token-wins extractor: the FIRST ticket id in the subject is the
  commit's ticket. That is right for a subject that LEADS with its id
  ("BL-1227: ... decouple unlanded BL-1192 gate wiring" is BL-1227's, the
  send-time gate's shape 2), and wrong for one that leads with none: on
  2026-09-11 the documenter's "Update BL-967 stall-diagnosis how-to for
  BL-1525's chokepoint fold" (a89a03ee45) was credited to BL-967, a done
  ticket whose lineage predates the tip-pure land machinery and so never
  reads landed, and the land step excluded the path as BL-967's - once
  when BL-1525 itself landed (961cbaa563) and again when BL-1526 did
  (evidence 7ddf201006). BL-1525's approved paragraph is absent from
  origin/main, and nothing reported it. A subject that names more than one
  ticket id and leads with none is AMBIGUOUS: the land step keeps the path
  when the landing ticket touches it itself, and otherwise refuses by name
  - it never decides such a path silently. Every scenario runs against a
  fixture repository under mkdtemp with its own origin (BL-1390).

  Background:
    Given a fixture repository with an origin, a main branch, a reviewing branch, a landing ticket, and a done sibling ticket whose lineage never reads landed

  # BL-1544 a-subject-that-leads-with-an-id-is-that-ids-alone-01
  Scenario: a subject that leads with the sibling's id and mentions the landing ticket later is the sibling's alone
    Given a commit on the reviewing branch touching a path whose subject leads with the sibling's id and mentions the landing ticket's id later in the same line
    When the land step computes the landing ticket's own paths
    Then that path is attributed to the sibling only and excluded as the sibling's, as the send-time gate's shape 2 already decides

  # BL-1544 an-ambiguous-subject-with-the-landers-own-touch-keeps-the-path-02
  Scenario: an ambiguous subject on a path the landing ticket also touched keeps the path for the landing ticket
    Given a commit on the reviewing branch touching a path whose subject names the sibling's id and the landing ticket's id and leads with neither
    And a commit whose subject leads with the landing ticket's id also touches that path
    When the land step computes the landing ticket's own paths
    Then that path is kept for the landing ticket with the sibling reported as a passenger, neither excluded nor refused

  # BL-1544 an-ambiguous-subject-with-no-own-touch-refuses-by-name-03
  Scenario: an ambiguous subject on a path no commit of the landing ticket's touched refuses the land by name instead of excluding the path
    Given a commit on the reviewing branch touching a path whose subject names the sibling's id and a third ticket's id and leads with neither
    And that path's content at the tip differs from origin/main
    And no commit naming the landing ticket touches that path
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_ESCALATE and the reason names that commit, both ticket ids its subject names, and the path
    And the path is never printed as an EXCLUDED_SIBLING_PATH

  # BL-1544 an-ambiguous-subject-whose-content-main-already-has-is-not-refused-04
  Scenario: an ambiguous subject whose path content is already on origin/main neither refuses nor excludes
    Given a commit on the reviewing branch touching a path whose subject names the sibling's id and a third ticket's id and leads with neither
    And that path's content at the tip is identical to origin/main
    When the land step runs for the landing ticket at the tip
    Then the land proceeds with no refusal and no exclusion for that path
