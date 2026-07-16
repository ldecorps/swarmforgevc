# mutation-stamp: sha256=86235badca5cf114109054c04b8c26eed197c382c775b15ff3e87d108523623a
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-16T03:38:38.693807329Z","feature_name":"The human answers the swarm offline via committed ANSWER files, gated on a live premise","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-440-offline-answer-file-return-path.feature","background_hash":"0b9e6eba64c8c70d7bdfc7316fbddecd93521348356a88e3fc9f6de57c7aa3c5","implementation_hash":"unknown","scenarios":[{"index":1,"name":"An answer whose premise has moved on is not executed and is reported as arrived-late","scenario_hash":"f8013bc6341a8a778f43d3dd15d63bced896884de140811f5f609d7f43b49b46","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-15T23:56:30.077450015Z"}]}
# acceptance-mutation-manifest-end

Feature: The human answers the swarm offline via committed ANSWER files, gated on a live premise

# BL-440 (feature, human-decided 2026-07-15): the swarm->human direction is already durable offline
# (questions live in git-committed BL topics, BL-329; the PWA + committed backlog/topics/*.json read from
# a checkout; asks PARK unanswered, BL-306). The human->swarm direction has NO offline path - away from
# Telegram the human's only recourse is hand-editing ticket YAML. Fix the asymmetry with ANSWER-*.md
# files at the backlog root, symmetric with the existing INTAKE-*.md convention: the human composes
# offline, commits, pushes; on reconnect/pull the swarm drains them through the same specifier-drain
# routing intake already uses. Resolves BL-242's deferred decision (b).
#
# The strictness that matters: a late answer is the premise-drift hot path (memory:
# escalation-resends-retracted-question; front-desk-operator-fabricates-backlog-state). Ingestion
# re-validates the referenced ask/ticket is still open and its premise unchanged BEFORE any execution.
# If the premise moved on (ticket shipped, question retracted, decision superseded) the answer is NOT
# acted on - it is surfaced back as "arrived late, not executed - here's what changed since." Never
# blind-execute a late answer.
#
# Scope (verify at build time): the specifier/coordinator drain routing that already handles INTAKE-*.md
# at the backlog root, extended to ANSWER-*.md; the ask/ticket liveness check (open vs.
# shipped/retracted/superseded); the archive move (mirror BL-311 intake-archive hygiene). Keep the answer
# schema FORGIVING - it is composed by a human on a plane, not a machine.

Background:
  Given an ANSWER-*.md file committed at the backlog root referencing an ask or ticket

# BL-440 offline-answer-file-return-path-01
Scenario: An answer to a still-open ask is drained and routed to that ask
  Given the referenced ask is still open and its premise is unchanged
  When the swarm drains the answer file
  Then the answer is routed to the referenced ask
  And it is acted on

# BL-440 offline-answer-file-return-path-02
Scenario Outline: An answer whose premise has moved on is not executed and is reported as arrived-late
  Given the referenced ticket has "<drift>"
  When the swarm drains the answer file
  Then the answer is not acted on
  And an "arrived late, not executed" report names what changed

  Examples:
    | drift                  |
    | already shipped        |
    | its question retracted |
    | its decision superseded|

# BL-440 offline-answer-file-return-path-03
Scenario: A drained answer file is archived, not deleted
  Given the referenced ask is still open
  When the swarm has drained the answer file
  Then the answer file is moved to the archive
  And it is not deleted

# BL-440 offline-answer-file-return-path-04
Scenario: A forgiving answer with a resolvable reference and human text is still ingested
  Given the answer omits some optional fields but carries a resolvable reference and the human's words
  When the swarm drains the answer file
  Then the referenced ask is resolved from the answer

# BL-440 offline-answer-file-return-path-05
Scenario: An answer whose reference cannot be resolved is surfaced, not silently dropped
  Given the answer references an ask or ticket that cannot be resolved
  When the swarm drains the answer file
  Then the answer is surfaced as unresolved
  And it is not silently dropped
