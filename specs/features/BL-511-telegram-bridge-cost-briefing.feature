Feature: the daily briefing estimates the Telegram front-desk bridge's cost per day

  # Operator INTAKE (2026-07-17, relayed from a Telegram question the Operator could
  # not answer): "estimate the cost of the extra Telegram token spend — how much extra
  # is spent on the Telegram bridge ... Add a per-day estimate of the incremental
  # token/cost overhead attributable to the Telegram front-desk bridge (operator
  # wakeups on TELEGRAM_TOPIC_MESSAGE, concierge/front-desk LLM processing) to the
  # daily briefing." Human decisions (confirmed 2026-07-17): basis = the EXACT cost
  # each front-desk/Operator `claude -p --output-format json` invocation already
  # reports (currently read for its reply then DELETED with the result file); scope =
  # front-desk concierge calls AND the incremental Telegram share of the always-on
  # Operator's wakeups; surface = the daily-briefing EMAIL (which today renders no cost
  # section — this is the first cost content wired into the email itself).
  #
  # Verified live layer (do not scope to dead paths):
  #  - Front-desk LLM call = headless `claude -p --output-format json` spawned by
  #    launch-front-desk-operator! per Telegram subject; its result (with total_cost_usd
  #    + usage) is read by front-desk-reply-text (operator_lib.bb) and the result file is
  #    deleted by reap-finished-front-desk-operator! (operator_runtime.bb ~1350). The
  #    exact figure must be captured BEFORE that delete.
  #  - The always-on Operator drains batches that MIX TELEGRAM_TOPIC_MESSAGE events with
  #    SWARM_CHECK_TIMER (and other) events; its batches archive to
  #    .swarmforge/operator/events-done/. A wakeup with no Telegram event is not bridge cost.
  #  - The daily-briefing email appends optional section blocks via the adapter map in
  #    briefing_email_lib.bb (optional-section-adapter-keys) -> a *-briefing-line fn in
  #    handoffd.bb -> a compiled extension/out/tools/*.js CLI. A blank/nil block is
  #    skipped by append-content-block, never crashes — this is the seam a new bridge-cost
  #    line plugs into. Model: BL-263 (one added briefing line) and BL-213 (cost -> briefing).
  #
  # Attribution rule (this feature pins it):
  #  - The front-desk operator is DEDICATED to Telegram, so 100% of a front-desk
  #    invocation's cost is bridge cost.
  #  - The Operator is shared, so a wakeup is attributed by its Telegram SHARE of the
  #    batch: cost x (Telegram events / total events). A purely-timer batch contributes 0.
  #
  # Non-behavioral gates:
  #  - The durable per-invocation record is machine-local runtime state written under
  #    .swarmforge/operator/ (gitignored); it is NOT committed and NOT pushed to the
  #    static PWA projection (local-engineering rule 5: machine-local/live data belongs on
  #    the host-side briefing, never backlog.json). The log path is an INJECTED seam so the
  #    reader is tested against a fixture, never a repo-root sibling (Stryker sandbox rule).
  #  - The reader/CLI is pure over its provided records + a provided day-key and injected
  #    log path: no network, no real timers, no real-clock day bucketing. main() is a thin
  #    wrapper over exported computeTelegramBridgeCostForDay / formatTelegramBridgeCostLine
  #    and is exercised in-process (thin-wrapper + in-process-main rules).
  #  - The Babashka capture step stays thin (append one record); the heavy attribution and
  #    formatting logic lives in the mutation-gated TypeScript reader.

  # BL-511 capture-frontdesk-before-reap-01
  Scenario: a completed front-desk call's exact cost is captured before its result is discarded
    Given a front-desk Telegram-reply invocation that reports an exact total cost and model
    When the invocation is reaped
    Then a record carrying that exact cost, the model, and the front-desk kind is appended
      to the durable per-invocation bridge-cost log
    And the record is written before the invocation's result file is deleted

  # BL-511 capture-operator-event-breakdown-02
  Scenario: a Telegram-triggered Operator wakeup is captured with its batch event breakdown
    Given an Operator wakeup whose batch holds both Telegram messages and timer events
    When the wakeup is reaped
    Then a record carrying its exact cost, the count of Telegram events, and the total event
      count in the batch is appended to the bridge-cost log

  # BL-511 frontdesk-attributed-fully-03
  Scenario: a front-desk invocation counts wholly as bridge cost, with no batch proration
    Given a recorded front-desk invocation for a day
    When the day's Telegram-bridge cost is computed
    Then its whole cost counts as bridge cost regardless of any batch event breakdown

  # BL-511 operator-prorated-by-share-04
  Scenario Outline: an Operator wakeup is attributed by its Telegram share of the batch
    Given a recorded Operator invocation for a day whose batch held <telegram> Telegram
      events out of <total> total events
    When the day's Telegram-bridge cost is computed
    Then <attributed> of that invocation's cost is attributed to the bridge

    Examples:
      | telegram | total | attributed          |
      | 3        | 3     | the full cost       |
      | 1        | 4     | a quarter           |
      | 0        | 5     | none                |

  # BL-511 briefing-line-total-and-breakdown-05
  Scenario: the briefing email shows the day's total bridge cost with a breakdown
    Given a day with recorded front-desk and Telegram-triggered Operator invocations
    When the daily briefing email is composed
    Then it shows one line with the day's total estimated Telegram-bridge cost
    And the line breaks the total into the front-desk call count and the Operator-attributed share

  # BL-511 unknown-cost-not-invented-06
  Scenario: an invocation whose exact cost is unknown is recorded as unknown, never counted as zero
    Given a recorded bridge invocation that reports no total cost and whose model is unpriced
    When the day's Telegram-bridge cost is computed
    Then that invocation is treated as unknown cost and excluded from the total
    And it is never counted as a zero-dollar invocation

  # BL-511 line-omitted-when-nothing-to-show-07
  Scenario Outline: the line is omitted without error when there is nothing to show
    Given the bridge-cost log <log_state>
    When the daily briefing email is composed
    Then the Telegram-bridge cost line is omitted and the rest of the briefing is unaffected

    Examples:
      | log_state                  |
      | has no records for the day |
      | is absent                  |
      | is unreadable              |
