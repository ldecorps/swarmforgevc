# mutation-stamp: sha256=7f22450f14b875efdccf86dc7ef064874650968a1e437d8ae66e54c5839b7111
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-01T09:48:52.331548395Z","feature_name":"the specifier may merge and split intakes, not only drain them one to one","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-680-specifier-consolidation-authority.feature","background_hash":"cde48f59ccbcfb5aab84be3ffa09b02047c8e416a2fc7ddc074f29bf30fc0427","implementation_hash":"unknown","scenarios":[{"index":4,"name":"the prompt bounds what consolidation may touch and produce","scenario_hash":"d61c6d0d9cb0926f9dd3a724c775bca5e62d740e4a3abaa3a602134bc3bfef68","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-01T09:48:52.331548395Z"}]}
# acceptance-mutation-manifest-end

Feature: the specifier may merge and split intakes, not only drain them one to one

  specifier.prompt's intake contract says "the moment you turn ONE of these
  into A ticket" — an implicit 1:1 mapping, with the words merge, split and
  consolidate appearing zero times in the whole prompt. The cost is measured,
  not hypothetical: nine operator intakes filed on 2026-07-26 proposed the
  SAME deterministic transcript walker as their mechanism in three of them, so
  a 1:1 drain mints three overlapping tickets that then have to be sequenced by
  hand — exactly what happened to the standing-topic cluster, whose
  independently-filed tickets all carried a `depends_on: []` that was a lie.

  This slice grants the authority and bounds it. N intakes may become one
  ticket; one intake may become N tickets; and when an epic goes top-priority
  the specifier sweeps that epic's orbit and consolidates it in one pass. The
  bounds matter as much as the grant: a merged result still has to fit
  BL-634's size envelope, consolidation happens at spec time only — an
  in-flight ticket is untouchable — and no consolidation may ever drop a
  human sentence.

  That last rule is stated here as a role obligation. It is ALSO being
  ratified as constitutional law in BL-681, deliberately: it has to bind every
  future consolidator, not just whoever holds this prompt.

  Background:
    Given the specifier role prompt

  # BL-680 consolidation-authority-01
  Scenario: the prompt grants the N-to-1 merge and states its traceability contract
    Then it instructs that several intakes may become one ticket
    And it instructs that the resulting ticket lists every source intake
    And it instructs that each source intake archives with a pointer to that ticket

  # BL-680 consolidation-authority-02
  Scenario: the prompt grants the 1-to-N split and states its traceability contract
    Then it instructs that one intake may become several tickets
    And it instructs that the intake archives once pointing at every resulting ticket
    And it instructs stating which part of the intake went to which ticket
    And it instructs that each resulting ticket records which intake it came from

  # BL-680 consolidation-authority-03
  Scenario: the prompt requires every human sentence to survive a consolidation
    Then it instructs that every operator directive quoted in a source intake survives verbatim
    And it names that rule as the one hard constraint on consolidating

  # BL-680 consolidation-authority-04
  Scenario: the prompt describes the epic-top-priority consolidation pass
    Then it instructs sweeping the open intakes and paused tickets in a top-priority epic's orbit
    And it instructs merging overlaps, splitting oversized slices and retiring superseded ones
    And it instructs correcting depends_on entries the cluster contradicts
    And it instructs recording the consolidation on the epic so the history stays walkable

  # BL-680 consolidation-authority-05
  Scenario Outline: the prompt bounds what consolidation may touch and produce
    Then it instructs that <bound>

    Examples:
      | bound                                                              |
      | a merged result still fits the slice size envelope                 |
      | a ticket in the active backlog is never consolidated               |

  # BL-680 consolidation-authority-06
  Scenario: a merge that would drop a quoted directive is refused rather than trimmed
    Given two source intakes each quoting a distinct operator directive
    When they are merged into one ticket
    Then both quoted directives appear verbatim in the resulting ticket

  # BL-680 consolidation-authority-07
  Scenario: a split maps every part of the intake onto a resulting ticket
    Given one intake proposing three separable mechanisms
    When it is split into three tickets
    Then each mechanism is named in exactly one resulting ticket
    And the archived intake points at all three

  # BL-680 consolidation-authority-08
  Scenario: a split that would drop a shared quoted directive is refused rather than trimmed
    Given one intake quoting a shared operator directive alongside three separable mechanisms
    When it is split into three tickets
    Then the shared quoted directive appears verbatim on every resulting ticket

  # BL-680 consolidation-authority-09
  Scenario: each resulting ticket from a split independently names the intake it came from
    Given one intake proposing three separable mechanisms
    When it is split into three tickets
    Then every resulting ticket records the source intake id on its own
