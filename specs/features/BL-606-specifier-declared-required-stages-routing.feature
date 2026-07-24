# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-23T22:18:25.668319111Z","feature_name":"the specifier declares required_stages and the handoff layer routes a ticket only through those stages","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-606-specifier-declared-required-stages-routing.feature","background_hash":"a4f98af41800a9d72cc6386505bd6f7e0b47e62265f9fee74a10dffdadcdff49","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a ticket with no usable required_stages declaration runs the full canonical chain","scenario_hash":"67e252b9845135df62980406e58d91061663cf84fb6fae90b024477bb6300b20","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-23T22:15:44.680138216Z"},{"index":3,"name":"a present declaration that adds, duplicates, or misnames a stage is rejected to default-full","scenario_hash":"ea21f5d27ed87c7fcbb25d4ccbfd2787a65f7a46f27163374e0fbec33678199a","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-23T22:15:44.680138216Z"},{"index":4,"name":"QA may be omitted only when coder is also omitted, and the decision is logged","scenario_hash":"b8b42c75c59f79177d01345bfcd0508520a5838a77c6e1a7d949c503f819fb90","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-07-23T22:15:44.680138216Z"},{"index":8,"name":"a reviewer's backward bounce is delivered to its literal destination, never rewritten forward","scenario_hash":"4b14374d363eca966ce34ef1aa97164f2b7845645f1ed24d30af000b7c1eae06","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-07-23T22:15:44.680138216Z"}]}
# acceptance-mutation-manifest-end

Feature: the specifier declares required_stages and the handoff layer routes a ticket only through those stages

  # BL-606: a ticket's spec may declare required_stages — an allowlist over the canonical
  # skippable chain (coder, cleaner, architect, hardender, documenter, qa). At each git_handoff
  # the send path rewrites the destination to the NEXT REQUIRED stage instead of the next literal
  # stage, skipping unlisted stages. Guardrails: default-full when the declaration is absent or
  # malformed; a global kill-switch that makes routing inert; QA forced whenever code is produced;
  # every skip recorded greppably. Canonical order is PIPELINE.md's real order
  # (coder->cleaner->architect->hardender->documenter->qa), NOT the order garbled in the ticket
  # Problem prose. required_stages is written as a single-line flow list (required_stages:
  # [coder, cleaner, qa]) so the existing line-based ticket reader can parse it.

  Background:
    Given required_stages routing is enabled

  # BL-606 default-full-when-no-usable-declaration-01
  Scenario Outline: a ticket with no usable required_stages declaration runs the full canonical chain
    Given an active ticket whose required_stages is <declaration>
    When the ticket runs the pipeline
    Then the parcel is routed through every canonical stage in order

    Examples:
      | declaration        |
      | absent             |
      | an empty list      |
      | a non-list scalar  |

  # BL-606 strict-subset-routes-only-listed-stages-02
  Scenario: a strict subset routes only through the listed stages in canonical order
    Given an active ticket whose required_stages is [coder, cleaner, qa]
    When the coder forwards the parcel
    Then the next stage to receive the parcel is cleaner
    And when the cleaner forwards the parcel the next stage to receive it is QA
    And architect, hardender and documenter never receive a handoff for that ticket

  # BL-606 every-skip-is-recorded-in-the-trail-03
  Scenario: each skipped stage leaves a greppable record naming the stage and the reason
    Given an active ticket whose required_stages is [coder, qa]
    And the specifier recorded a skip reason for the omitted stages
    When the coder forwards the parcel toward the next required stage
    Then the routing record names each skipped stage and its stated reason
    And a skipped-stage lineage is distinguishable from a completed-stage lineage after the fact

  # BL-606 present-but-invalid-declaration-is-rejected-to-default-full-04
  Scenario Outline: a present declaration that adds, duplicates, or misnames a stage is rejected to default-full
    Given an active ticket whose required_stages is <declaration>
    When the ticket runs the pipeline
    Then the declaration is rejected as invalid
    And the parcel is routed through every canonical stage in order

    Examples:
      | declaration                              |
      | a list naming a stage outside the chain  |
      | a list naming specifier or coordinator   |
      | a list containing a duplicate stage      |

  # BL-606 qa-only-droppable-for-a-declared-non-code-ticket-05
  # A "non-code ticket" is defined as one whose required_stages omits coder (produces no code).
  # QA may be omitted only for that class; omitting QA while coder is present is invalid and
  # falls back to default-full (with QA). Either way the QA-omission decision is logged loudly.
  Scenario Outline: QA may be omitted only when coder is also omitted, and the decision is logged
    Given an active ticket whose required_stages is <declaration>
    When the ticket runs the pipeline
    Then the ticket <qa outcome>
    And the QA omission decision is logged loudly

    Examples:
      | declaration       | qa outcome                                             |
      | [documenter]      | runs without QA as a declared non-code ticket          |
      | [coder, cleaner]  | is rejected and runs the full canonical chain with QA  |

  # BL-606 next-required-stage-is-a-pure-function-06
  #
  # hardener note: Gherkin-mutating a stage token's CASE in this scenario's
  # "required set" / "current stage" columns (e.g. coder -> coDer) is an
  # accepted-equivalent, not a real survivor - required_stages_lib.bb's
  # next-required-stage self-normalizes both arguments through
  # normalize-token before comparing (see its own docstring: "a caller can
  # pass raw declared tokens or an already-canonical set/role name with
  # identical results"), so a case-mutated example produces byte-identical
  # behavior to the original. No assertion could ever distinguish them
  # (BL-234 precedent). The manifest correctly omits this scenario per its
  # own clean-scenarios-only contract (BL-502) - this is expected, not a gap.
  Scenario Outline: next-required-stage resolves purely over the declared set and the current stage
    Given the required_stages set <required set>
    When the next required stage after <current stage> is resolved
    Then the resolved next stage is <next stage>

    Examples:
      | required set          | current stage | next stage |
      | [coder, cleaner, qa]  | coder         | cleaner    |
      | [coder, cleaner, qa]  | cleaner       | QA         |
      | [coder, qa]           | coder         | QA         |
      | [coder, cleaner, qa]  | QA            | none       |

  # BL-606 kill-switch-off-makes-routing-inert-07
  # The ON case for this same ticket is scenario 02 (cleaner forwards to QA); with the switch OFF
  # the identical ticket ignores the subset and continues down the full chain to architect.
  Scenario: with the kill-switch off, a subset ticket still runs the full canonical chain
    Given required_stages routing is disabled
    And an active ticket whose required_stages is [coder, cleaner, qa]
    When the cleaner forwards the parcel
    Then the next stage to receive the parcel is architect

  # BL-606 completed-ticket-stage-visibility-08
  Scenario: a completed routed ticket answers which stages ran and which were skipped
    Given a completed ticket that ran with required_stages [coder, qa]
    When the ran-and-skipped stages for that ticket are reported
    Then the report names coder and QA as run
    And names cleaner, architect, hardender and documenter as skipped-by-routing
    And the answer is derived from the recorded trail, not inferred from the code diff

  # BL-606 reviewer-bounce-is-never-rewritten-onto-the-bouncer-09
  # architect bounce #3 (repros D and E): a reviewer's plain hand-written bounce
  # carries no rejection_reason/reroute_reason header - no role prompt or the
  # handoff protocol ever mentions either one on a review bounce. Direction must
  # come from the sender's own position in canonical order instead, or the
  # bounce is rewritten forward onto the bouncer itself and can never reach the
  # role that owns the fix.
  Scenario Outline: a reviewer's backward bounce is delivered to its literal destination, never rewritten forward
    Given an active ticket whose required_stages is <declaration>
    When <sender> bounces the parcel to <literal to>
    Then the parcel is delivered to <literal to>
    And no routing_skipped header is recorded for that bounce

    Examples:
      | declaration     | sender    | literal to |
      | [coder, qa]     | QA        | documenter |
      | [architect, qa] | architect | coder      |
