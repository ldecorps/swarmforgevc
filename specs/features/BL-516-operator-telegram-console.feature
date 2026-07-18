Feature: the operator Telegram console gives a phone-glanceable, allowlisted status + ensure surface

  # Human spec brief 2026-07-18 ("Operator Telegram console — status slice"), Slice 1 of the Telegram
  # operator surface. A separate, tightly-allowlisted operator bot (its OWN token — NOT the front-desk
  # support bot), supervised by the always-alive operator daemon exactly like the vscode tunnel:
  # ensure-telegram! is called each tick by operator_runtime.bb and relaunches the poller headlessly if
  # it died. Long-poll (getUpdates) transport — no webhook, no inbound port. One allowlisted Telegram
  # user id; every other sender is ignored and no swarm data ever leaves to a non-allowlisted id.
  #
  # DECISIONS (human, 2026-07-18): (1) poller = supervised SUBPROCESS mirroring the tunnel (a long-poll
  # blocks and the tick is ~1s, so the daemon only checks liveness per tick; the poller owns its loop).
  # (2) file form = operator_telegram.bb (babashka http-client, consistent with operator_runtime.bb /
  # operator_ask.bb). (3) secret = env var (TELEGRAM_BOT_TOKEN-style OWN token + an allowed-id env),
  # passed to the subprocess via an explicit :extra-env allowlist as front_desk_supervisor.bb already
  # does; never committed; 600-mode if ever on disk. (4) command set = /status /ensure /tunnel /help.
  # (5) /ensure = TWO-TAP confirm + single-flight. (6) code placement = LOGIC in tracked
  # swarmforge/scripts/ (operator_telegram.bb + the ensure-telegram! hook in operator_runtime.bb,
  # committed normally through the pipeline like BL-511 did); only runtime STATE/secrets live in
  # gitignored .swarmforge/operator/. (The brief's "all files in .swarmforge/ / don't touch
  # swarmforge/scripts" was inaccurate — the operator logic layer IS swarmforge/scripts/.)
  #
  # SEAM for later slices (out of scope here, do not build): the sendMessage-to-allowlisted-id primitive
  # built for the replies here IS the seam slice 2 (proactive alerts) will add triggers to; keep it a
  # reusable pure function, not inlined per-command. No write path beyond /ensure; no mini-app webview.
  #
  # VERIFIED LIVE LAYER (grep before building; operator files are gitignored, confirm on the box):
  #  - operator_runtime.bb ensure-tunnel! (~L1431) shells `bash <helper> ensure <root>` each tick
  #    (call site ~L1633) and never throws into the tick; read-tunnel-status reads tunnel.status.json and
  #    folds {state,url,...} into status.json. ensure-telegram! mirrors this beside it (SKIP env no-op).
  #  - status.json already carries `tunnel` and `front_desk` blocks; the console adds its OWN block
  #    `telegram_console: {state: ok|disabled|auth_lost, last_poll_at}` — named distinctly so it is not
  #    confused with the existing front_desk (support-bot) telegram surface.
  #  - front_desk_supervisor.bb is prior art for a supervised Telegram long-poll bot + :extra-env creds,
  #    but the console is a SEPARATE bot on the operator tick, not an extension of the front desk.
  #  - Testable core is pure decision logic (allowlist check, command dispatch, single-flight state,
  #    auth-loss state machine) exercised by a .bb runner in swarmforge/scripts/test/ + the shell smoke
  #    suite; the live getUpdates/sendMessage HTTP is the untestable boundary, injected as a fake.

  Background:
    Given the operator Telegram poller is running with a valid bot token and my user id allowlisted

  # BL-516 operator-telegram-status-01
  Scenario: the allowlisted operator gets a fleet status summary
    When I send "/status"
    Then I receive a summary with overall health, the active roles, the tunnel URL, and the status.json freshness

  # BL-516 operator-telegram-non-allowlisted-refused-02
  Scenario: a non-allowlisted sender is refused and logged, with no swarm data returned
    Given a message arrives from a user id that is not on the allowlist
    When the poller processes it
    Then no swarm data is returned to that sender and the ignored sender is logged

  # BL-516 operator-telegram-ensure-confirm-03
  Scenario: /ensure asks for a confirm tap before running anything
    When I send "/ensure"
    Then the poller replies asking me to confirm and does not run ensure yet

  # BL-516 operator-telegram-ensure-confirmed-04
  Scenario: a confirmed /ensure runs ./swarm ensure once and reports the result
    Given I sent "/ensure" and was asked to confirm
    When I confirm
    Then ./swarm ensure runs exactly once and I receive its exit code and a short output tail

  # BL-516 operator-telegram-ensure-busy-05
  Scenario: a second /ensure while one is already running is rejected as busy
    Given an ensure is already running
    When I send "/ensure"
    Then it is rejected with a busy notice and no second ensure is started

  # BL-516 operator-telegram-readonly-commands-06
  Scenario Outline: a read-only command returns only its own information and runs no control action
    When I send "<command>"
    Then I receive <response> and no control action runs

    Examples:
      | command | response                       |
      | /tunnel | the tunnel URL and its state   |
      | /help   | the list of supported commands |

  # BL-516 operator-telegram-disabled-07
  Scenario Outline: the console disables cleanly and marks itself disabled, daemon otherwise unaffected
    Given <disabling_condition>
    When the daemon ticks
    Then no poller is started and the daemon is otherwise unaffected
    And status.json shows the telegram console state as disabled

    Examples:
      | disabling_condition                        |
      | SWARMFORGE_SKIP_TELEGRAM is set in the env |
      | no operator bot token is configured        |

  # BL-516 operator-telegram-self-heal-08
  Scenario: a dead poller is relaunched headlessly on the next tick
    Given the poller subprocess has died
    When the next tick runs ensure-telegram!
    Then the poller is relaunched headlessly with no manual step required

  # BL-516 operator-telegram-auth-lost-09
  Scenario: an invalid token surfaces auth_lost and backs off instead of crash-looping
    Given Telegram returns a 401 for the operator bot token
    When the poller detects it
    Then status.json shows the telegram console state as auth_lost and the poller backs off rather than crash-looping
