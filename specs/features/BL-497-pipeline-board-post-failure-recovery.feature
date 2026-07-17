# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-17T13:04:13.850237693Z","feature_name":"the pipeline board surfaces and recovers from a failed post instead of freezing silently","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-497-pipeline-board-post-failure-recovery.feature","background_hash":"167d7f3fcbb7a5e1f5e447208325ff261acee3c5142ef004864f34abebcd8912","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: the pipeline board surfaces and recovers from a failed post instead of freezing silently

  # Live outage 2026-07-17 (RCA: backlog/evidence/pipeline-board-frozen-live-outage-20260717.md).
  # The Telegram Pipeline Board message went unchanged for 10+ hours while the concierge
  # tick loop stayed alive (the Approvals roster, same bot/token/chat, kept updating). The
  # board's post path swallows EVERY failure with no logging anywhere:
  #   - the bot's postMessage adapter maps the Telegram result to `r.success ? r.messageId
  #     : undefined`, discarding the error string;
  #   - pipelineBoardSync.postBoardMessage sees `messageId === undefined`, returns
  #     outcome 'failed-post', and leaves the stale topicId/messageId otherwise untouched;
  #   - conciergeTick.syncBoardIfWired discards result.outcome entirely.
  # So every tick recomputes a fresh content signature, reposts, fails again — silently,
  # forever, with no cap, no backoff-then-alert, and no self-heal. Since BL-462 the board
  # POSTS a fresh message then best-effort DELETES the old one, so a stale messageId can
  # only break the (non-blocking) delete; the failing call is the POST into the board topic
  # itself (topic archived/deleted, an HTML-parse rejection, or rate-limiting).
  #
  # This feature pins the observable contract: (1) every failed board outcome surfaces its
  # underlying Telegram error rather than swallowing it; (2) a failure whose error names the
  # topic/thread as GONE clears the tracked topic so the next tick re-ensures a fresh one and
  # recovers, while a TRANSIENT (or unclassifiable) error retains the topic and never
  # recreates it; (3) the retry loop is bounded and raises exactly ONE operator alert on
  # exhaustion, armed only on confirmed delivery and re-armed after recovery. The render and
  # change-gate contract (BL-462/464/465/468/473) is unchanged — this is a plumbing and
  # observability defect in the post path, not a data or rendering defect. The seam for
  # surfacing the error and for emitting the alert is the architect's call; the scenarios
  # below hold either way.

  Background:
    Given the board content has changed since the last post so a post is attempted
    And the board's tracked topic id is "1634" with a prior posted message

  # Hardener (BL-234 equivalent-mutant note, 2026-07-17): a soft Gherkin mutation pass
  # single-character-mangles every <error> example VALUE in both outlines below (13
  # mutants total: 8 killed, 5 survived - all 5 survivors are <error> text mutations,
  # e.g. "message thread not found" -> "meSsage thread not found"). Each is an
  # equivalent mutant, not a gap: the SAME <error> string drives both the Given step
  # (injects it as the adapter's returned error) and the Then step (asserts the
  # surfaced error equals that same string) in outline -01, so a mutated value simply
  # round-trips to itself - a self-consistency check no <error> mutation could ever
  # fail. pipelineBoardSync.ts only ever carries `error` through OPAQUELY: passed
  # straight into the result (postBoardMessage/syncPipelineBoard) and interpolated,
  # unvalidated, into the human-facing alert text (buildFailureAlertText) - it is never
  # compared against a closed set the way <class>/<topic_action> in outline -02 are
  # (via classifyBoardFailure's explicit TOPIC_GONE/TRANSIENT signature lookups), which
  # is exactly why every <class>/<topic_action> mutant in outline -02 IS killed while
  # every <error>-text mutant in both outlines survives. Same class as BL-452's own
  # <id>-passthrough equivalent-mutant note in that feature file. No artificial
  # assertion was added to force these 5 to die.
  # BL-497 pipeline-board-post-failure-recovery-01
  Scenario Outline: a failed board outcome surfaces its underlying Telegram error instead of swallowing it
    Given the board <failing_step> fails with error "<error>"
    When the board sync runs
    Then the sync reports the failure with the error "<error>"
    And the failure is not silently swallowed

    Examples:
      | failing_step         | error                                 |
      | post to the topic    | Bad Request: message thread not found |
      | topic creation       | Too Many Requests: retry after 26     |

  # BL-497 pipeline-board-post-failure-recovery-02
  Scenario Outline: the board classifies a failed post to decide whether to abandon its stale topic
    Given the board post to the topic fails with error "<error>"
    When the board sync runs
    Then the failure is classified as "<class>"
    And the tracked topic id is "<topic_action>"

    Examples:
      | error                                 | class      | topic_action |
      | Bad Request: message thread not found | topic-gone | cleared      |
      | Too Many Requests: retry after 26     | transient  | retained     |
      | ENOTFOUND api.telegram.org            | transient  | retained     |

  # BL-497 pipeline-board-post-failure-recovery-03
  Scenario: after a topic-gone clear the next tick re-ensures a fresh topic and posts the board
    Given the board post to the topic failed with error "Bad Request: message thread not found"
    And the board sync cleared the tracked topic id on that tick
    When the board sync runs again with a topic that now accepts the post
    Then a fresh board topic is ensured
    And the board is posted into the fresh topic
    And the board is visible again without human intervention

  # BL-497 pipeline-board-post-failure-recovery-04
  Scenario: repeated transient failures raise exactly one operator alert at the retry cap
    Given the board post to the topic has failed transiently on each of the last cap-minus-one ticks
    When the board sync runs and the post fails transiently again
    Then exactly one operator alert naming the frozen board is emitted
    And the same topic id "1634" is retained without creating a new topic
    And a further transient failure on the next tick emits no additional alert

  # BL-497 pipeline-board-post-failure-recovery-05
  Scenario: a successful post clears the failure state so a later episode alarms fresh
    Given the board has been in a failed-post state with its operator alert already armed
    When a subsequent board sync posts the board successfully
    Then the recorded consecutive-failure count is reset to zero
    And the armed operator alert is cleared
    And a later transient failure episode is able to alarm again

  # BL-497 pipeline-board-post-failure-recovery-06
  Scenario: the operator alert arms only on confirmed delivery, never on the attempt
    Given the board post has failed transiently past the retry cap
    And emitting the operator alert itself fails
    When the board sync runs
    Then the operator alert is not recorded as delivered
    And the next failing tick attempts the operator alert again rather than suppressing it
