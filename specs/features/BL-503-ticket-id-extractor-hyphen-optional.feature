Feature: the pipeline board and dispatch-gap sweep resolve a ticket id from a task header that omits the prefix hyphen

  # BL-503 (dispositioned from a coordinator rule_proposal, live 2026-07-17). Both .bb
  # ticket-id extractors match only the HYPHENATED prefix form: pipeline_stage_lib.bb's
  # `(?i)\b(BL|GH)-(\d+)\b` and chase_sweep_lib.bb's `(?i)^((?:BL|GH)-\d+)`. Many coder task
  # names use the no-hyphen form (e.g. "bl493-fold-ticket-events"), so extract-ticket-id
  # returns nil for them. Observed live on BL-493 (task "bl493-..."): the pipeline-stage sync
  # dropped BL-493 from the board (the reported sync showed only BL-502), and the dispatch-gap
  # sweep finds no trail for BL-493 and would auto-route it to the coordinator as a spurious
  # gap. The fix makes the prefix hyphen OPTIONAL in BOTH extractors and CANONICALIZES every
  # match to the upper-case hyphenated BL-NNN form. pipeline_stage_lib.bb already
  # canonicalizes (BL-471); chase_sweep_lib.bb today returns the raw match un-canonicalized,
  # so it must ALSO start upper-casing/re-hyphenating (a lower-case "bl-493" match likewise
  # never joins the canonical active id "BL-493"). The allowlisted prefix (BL|GH) and the
  # digit/letter-adjacency guards are UNCHANGED: a glued prefix ("ABL-217") or a glued word
  # ("usable493") still resolves to nil, so no ticket is ever mis-swallowed (BL-217/BL-222).

  # BL-503 ticket-id-hyphen-optional-01
  Scenario Outline: the extractor resolves the no-hyphen prefix form and canonicalizes it, and never swallows a glued prefix
    When a ticket id is extracted from the task header "<task>"
    Then it resolves to "<resolved>"

    Examples:
      | task                       | resolved |
      | bl493-fold-ticket-events   | BL-493   |
      | BL-493-fold-ticket-events  | BL-493   |
      | bl-493-fold-ticket-events  | BL-493   |
      | gh77-issue-seeded          | GH-77    |
      | ABL-217-glued-prefix       | NONE     |
      | usable493-not-a-ticket     | NONE     |

  # BL-503 ticket-id-hyphen-optional-02
  Scenario: a held ticket whose task header omits the prefix hyphen still appears on the pipeline board at its stage
    Given active ticket "BL-493" is held at "cleaner" with task header "bl493-fold-ticket-events"
    When the pipeline stage sync runs
    Then the board shows "BL-493" at "cleaner"

  # BL-503 ticket-id-hyphen-optional-03
  Scenario: a dispatched ticket whose task header omits the prefix hyphen is not reported as a dispatch gap
    Given active ticket "BL-493" has a handoff whose task header is "bl493-fold-ticket-events"
    When the dispatch-gap sweep runs
    Then "BL-493" is counted as dispatched and is not auto-routed as a gap

# Non-behavioral gates:
#  - BOTH .bb extractors must satisfy scenario 01: pipeline_stage_lib.bb's extract-ticket-id
#    and chase_sweep_lib.bb's extract-ticket-id. Keep the two allowlists/patterns in sync
#    (this codebase's "small live-glue duplicated across independent pure libs" posture, per
#    each file's own known-ticket-prefixes comment) - do NOT let one accept the no-hyphen
#    form while the other rejects it.
#  - The extractor's output is CANONICAL: upper-case, hyphenated BL-NNN, regardless of the
#    input's case or hyphenation. chase_sweep_lib.bb's collect-dispatched-ticket-ids feeds a
#    case-sensitive membership test against the active yaml's own canonical id, so a
#    non-canonical match silently fails the join (scenario 03 is the guard).
#  - The prefix stays an ALLOWLIST (BL|GH), never an unbounded [A-Za-z]+; the glued-prefix
#    rows in scenario 01 are the no-over-match regression (BL-217/BL-222).
#  - .bb scripts have no mutation/CRAP/DRY gate (engineering.prompt): the real gate is the
#    unit suite under swarmforge/scripts/test/ PLUS these scenarios. Add unit coverage of the
#    no-hyphen and glued-prefix cases for both extractors there.
