# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-16T16:34:17.638986023Z","feature_name":"QA bounces are recorded with structured attribution so which agent bounces most from QA becomes answerable","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-454-qa-bounce-metric.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: QA bounces are recorded with structured attribution so which agent bounces most from QA becomes answerable

  # BL-454 (feature, human-requested via Telegram 2026-07-16): 'which agent causes the most bounce-back from
  # QA?' is unanswerable today — there is no per-agent QA-bounce counter. When QA fails a parcel it hand-writes
  # backlog/evidence/<task>-bounce-<YYYYMMDD>.md (committed to main; failure class in {compile, unit,
  # integration, acceptance, behavior}) and hands back to the coder; attribution to a producing role + ticket
  # type exists only as prose/filename across ~83 files. Data-source fork settled with the human via
  # AskUserQuestion: BOTH a structured go-forward writer (a new record-qa-bounce CLI QA runs at bounce time,
  # appending one JSON line { ticket, producing_role, ticket_type, failure_class, commit, at } to a machine-
  # local .swarmforge/qa_bounces/<YYYY-MM>.jsonl) AND a one-time IDEMPOTENT backfill from the evidence corpus.
  # A pure computeQaBounceTally(records) ranks roles and breaks down by ticket type; a host-side surface (a
  # daily-briefing line via briefing_email_lib.bb's optional-section adapters — machine-local data, NOT the
  # static PWA, local-engineering rule 5) shows it.
  #
  # Attribution is a CLOSED set — producing_role in {coder, cleaner, architect, hardender, documenter},
  # ticket_type in {feature, bug, defect, chore, docs, enhancement, epic}, failure_class in {compile, unit,
  # integration, acceptance, behavior}. The outline step handler validates each Examples column against an
  # explicit KNOWN_VALUES lookup (never a passthrough) so a mutated value fails the acceptance run
  # immediately (engineering load-bearing-column rule). The CLI keeps main() a thin wrapper covered
  # in-process (thin-wrapper + worker-thread rules); the writer's LIVE trigger is QA at bounce time, wired
  # via swarmforge/roles/QA.prompt in the same parcel (live-writer rule).

  # BL-454 qa-bounce-01
  Scenario Outline: Recording a bounce captures its producing role, ticket type, and failure class
    Given a QA bounce of ticket "<id>" produced by the "<role>" of type "<type>" with failure class "<class>"
    When the bounce is recorded
    Then the bounce log has one entry for "<id>" attributed to the "<role>" of type "<type>" with class "<class>"

    Examples:
      | id     | role       | type    | class      |
      | BL-340 | coder      | feature | behavior   |
      | BL-233 | documenter | docs    | acceptance |
      | BL-406 | hardender  | bug     | unit       |

  # BL-454 qa-bounce-02
  Scenario: Recording the same bounce twice does not double-count it
    Given a bounce for ticket "BL-340" has already been recorded
    When the same bounce is recorded again
    Then the bounce log still has exactly one entry for "BL-340"

  # BL-454 qa-bounce-03
  Scenario: The one-time backfill seeds one record per genuine bounce file
    Given an evidence corpus containing several bounce files
    When the one-time backfill runs
    Then each bounce file becomes one recorded bounce attributed to its producing role and ticket type
    And running the backfill again adds no further entries

  # BL-454 qa-bounce-04
  Scenario: A non-bounce evidence file is not counted as a bounce
    Given an evidence file that records a non-bounce outcome
    When the one-time backfill runs
    Then that file produces no bounce entry

  # BL-454 qa-bounce-05
  Scenario: The tally ranks roles by how often they bounce from QA
    Given recorded bounces attributed across several roles
    When the QA-bounce tally is computed
    Then the roles are ranked by bounce count with the most-bouncing role first

  # BL-454 qa-bounce-06
  Scenario: The tally breaks bounces down by ticket type
    Given recorded bounces attributed across several ticket types
    When the QA-bounce tally is computed
    Then each ticket type shows its own bounce count
