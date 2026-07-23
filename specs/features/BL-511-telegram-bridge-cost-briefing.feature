Feature: the daily briefing estimates the Telegram front-desk bridge's cost per day

  # Operator INTAKE (2026-07-17, relayed from a Telegram question the Operator could
  # not answer): "estimate the cost of the extra Telegram token spend — how much extra
  # is spent on the Telegram bridge." Human decisions (confirmed 2026-07-17): basis =
  # the EXACT cost each front-desk `claude -p --output-format json` invocation already
  # reports (currently read for its reply then DELETED with the result file); surface =
  # the daily-briefing EMAIL (which today renders no cost section — this is the first
  # cost content wired into the email itself).
  #
  # SCOPE NARROWED TO FRONT-DESK-ONLY (human decision, 2026-07-18). The original scope
  # also included "the incremental Telegram share of the always-on Operator's wakeups."
  # That share is NOT separately measurable, so it is dropped from this ticket and
  # documented as a known limitation rather than estimated. Why it cannot be captured:
  # the always-on Operator runs as an INTERACTIVE `claude --remote-control` session
  # (launch_operator.sh) — NOT a headless `claude -p --output-format json` call like the
  # front desk — so it emits NO per-wakeup total_cost_usd anywhere on disk; its cost is
  # only on the claude.ai account, server-side and unreachable at reap time. Inventing a
  # count x average estimate would violate the human's EXACT-cost basis and the
  # codebase's honest-null discipline (pricingTable.ts), so the Operator's Telegram
  # share is reported NOWHERE and this fact is recorded in code (a comment at the
  # capture/compute site). The front-desk operator IS dedicated to Telegram, so its
  # exactly-measured cost is the honest, fully-attributable bridge figure. The retired
  # Operator-capture and Operator-proration scenarios are 02 and 04 (gaps left on
  # purpose to mark the retirement; survivors keep their stable indices).
  #
  # Verified live layer (do not scope to dead paths):
  #  - Front-desk LLM call = headless `claude -p --output-format json` spawned by
  #    launch-front-desk-operator! per Telegram subject; its result (with total_cost_usd
  #    + usage) is read by front-desk-reply-text (operator_lib.bb) and the result file is
  #    deleted by reap-finished-front-desk-operator! (operator_runtime.bb ~1350). The
  #    exact figure must be captured BEFORE that delete.
  #  - The daily-briefing email appends optional section blocks via the adapter map in
  #    briefing_email_lib.bb (optional-section-adapter-keys) -> a *-briefing-line fn in
  #    handoffd.bb -> a compiled extension/out/tools/*.js CLI. A blank/nil block is
  #    skipped by append-content-block, never crashes — this is the seam the bridge-cost
  #    line plugs into. Model: BL-263 (one added briefing line) and BL-213 (cost -> briefing).
  #
  # Attribution rule (this feature pins it): the front-desk operator is DEDICATED to
  # Telegram, so 100% of a front-desk invocation's cost is bridge cost. There is no
  # proration and no Operator term — the shared always-on Operator is out of scope
  # (see SCOPE NARROWED above). The rendered line therefore reports the front-desk call
  # count only, never an "Operator $0.00 attributed" term (which would falsely report an
  # unmeasured share as a measured zero).
  #
  # Non-behavioral gates:
  #  - The durable per-invocation record is machine-local runtime state under
  #    .swarmforge/operator/ (gitignored); NOT committed and NOT pushed to the static PWA
  #    projection (local-engineering rule 5). The log path is an INJECTED seam so the
  #    reader is tested against a fixture, never a repo-root sibling (Stryker sandbox rule).
  #  - The reader/CLI is pure over its provided records + a provided day-key and injected
  #    log path: no network, no real timers, no real-clock day bucketing. main() is a thin
  #    wrapper over exported computeTelegramBridgeCostForDay / formatTelegramBridgeCostLine
  #    and is exercised in-process (thin-wrapper + in-process-main rules).
  #  - The Babashka capture step stays thin (append one record); the attribution and
  #    formatting logic lives in the mutation-gated TypeScript reader.

  # BL-511 capture-frontdesk-before-reap-01
  Scenario: a completed front-desk call's exact cost is captured before its result is discarded
    Given a front-desk Telegram-reply invocation that reports an exact total cost and model
    When the invocation is reaped
    Then a record carrying that exact cost, the model, and the front-desk kind is appended to the bridge-cost log
    And the record is written before the invocation's result file is deleted

  # BL-511 frontdesk-attributed-fully-03
  Scenario: a front-desk invocation counts wholly as bridge cost
    Given a recorded front-desk invocation for a day
    When the day's Telegram-bridge cost is computed
    Then its whole cost counts as bridge cost

  # BL-511 briefing-line-total-and-frontdesk-count-05
  Scenario: the briefing email shows the day's total bridge cost with the front-desk call count
    Given a day with recorded front-desk invocations
    When the daily briefing email is composed
    Then it shows one line with the day's total estimated Telegram-bridge cost and the front-desk call count

  # BL-511 unknown-cost-not-invented-06
  Scenario: a front-desk invocation whose exact cost is unknown is recorded as unknown, never counted as zero
    Given a recorded front-desk invocation that reports no total cost and whose model is unpriced
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
