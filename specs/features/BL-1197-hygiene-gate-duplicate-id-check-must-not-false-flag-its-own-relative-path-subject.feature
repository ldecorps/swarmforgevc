Feature: the specifier backlog hygiene gate's duplicate-id check does not false-flag a subject against itself

  # BL-1197 (epic swarm-reliability). Found while minting BL-1196: running
  # `specifier_backlog_hygiene_gate.sh backlog/paused/BL-1196-*.yaml` (the
  # gate's own documented usage shape, a repo-root-relative path) reported
  # DUPLICATE-ID against "also: <the same file, as an absolute path>" —
  # backlog_hygiene_lib.bb's `other-holders` removes the subject's own entry
  # from the local index by exact string equality between the path the
  # caller passed and the absolute path `read-local-id-index` always
  # produces (backlog-root is canonicalized). Any relative-path invocation
  # therefore never matches itself and is reported as a duplicate of itself.
  # Passing an absolute path instead makes the same file gate clean —
  # confirmed no real duplicate exists.

  Background:
    Given a paused ticket YAML file whose id appears nowhere else in the backlog tree

  # BL-1197 relative-path-subject-not-self-flagged-01
  Scenario: Gating a subject by a repo-root-relative path does not report it as a duplicate of itself
    Given the gate is invoked with the subject's path given relative to the repository root
    When the duplicate-id check runs
    Then no duplicate-id violation is reported for that subject

  # BL-1197 genuine-duplicate-still-caught-02
  Scenario: A genuine duplicate id at a different path is still reported
    Given a second ticket file elsewhere in the backlog tree declares the same id as the subject
    When the duplicate-id check runs
    Then a duplicate-id violation is reported naming the other file's path
