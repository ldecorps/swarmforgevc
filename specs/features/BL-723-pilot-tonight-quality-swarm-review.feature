Feature: Live swarm reviews tonight's pilot-landed defect quality
  After an offline pilot closed a batch of low-mutation defects, the live swarm
  must queue-jump a review and say whether those landings meet normal
  live-swarm quality. Source: human via Let's Talk 2026-07-30; BL-723. The
  review's durable artifacts are the review body under docs/how-to, the email
  body committed under docs/briefings (which handoffd's briefing sweep mails to
  notify_email_to), and the verdict written back onto each reviewed ticket.

  Background:
    Given the review body docs/how-to/BL-723-pilot-tonight-quality-review.md exists
    And the email body docs/briefings/2026-07-30-bl723-pilot-review.md exists

  # BL-723 review-01
  Scenario: every primary ticket gets a quality look
    When the review body is read
    Then it carries a per-ticket verdict section for each of BL-718, BL-627, BL-636, BL-637, BL-641, BL-642, BL-646, BL-623, BL-671, BL-694, BL-559, BL-661, and BL-662

  # BL-723 review-02
  Scenario: explicit on-par verdict is recorded
    When the review body is read
    Then it states the overall on-par or not-on-par verdict
    And it names reasons for that verdict against normal live coder-through-qa expectations

  # BL-723 review-03
  Scenario: a per-seat viewpoint is recorded for every required stage
    When the review body is read
    Then it carries a distinct viewpoint section for each of <seat>

    Examples:
      | seat       |
      | coder      |
      | cleaner    |
      | architect  |
      | hardender  |
      | documenter |
      | QA         |

  # BL-723 review-04
  Scenario: the QA viewpoint is the fullest section
    When the review body is read
    Then the QA viewpoint section is longer than every other seat's viewpoint section

  # BL-723 review-05
  Scenario: shortfalls file both remaining-work and pilot-process defects
    When the review body records a shortfall against live-swarm quality
    Then a remaining-work defect ticket exists for what is still wrong or unfinished
    And a pilot-process defect ticket also exists
    And the pilot-process defect names what the pilot missed or which gate should have caught it
    And each filed defect carries type defect with an explicit severity

  # BL-723 review-06
  Scenario: verdicts are written back onto reviewed tickets
    When each reviewed done ticket's YAML is read
    Then its notes carry that ticket's on-par or not-on-par verdict
    And its notes point to any remaining-work or pilot-process defect filed against it

  # BL-723 review-07
  Scenario: reviewing a landing never rewrites its done history
    When the review completes
    Then every reviewed ticket remains in backlog/done
    And no reviewed ticket's acceptance or description was rewritten without a warranted revert

  # BL-723 review-08
  Scenario: the email body reaches the human through the live send path
    When the email body is read
    Then it states the overall on-par or not-on-par verdict
    And it carries the per-seat viewpoints including QA
    And its first non-empty line is a headline of at most 80 characters carrying the verdict

  # BL-723 review-09
  Scenario: this review is not run as offline pilot
    When the review body is read
    Then it records that BL-723 walked the live swarm path after queue-jump
    And it records that BL-723 was not driven by the offline expeditor or pilot
