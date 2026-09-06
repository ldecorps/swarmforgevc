# GH-24 — coder bounce fix, 2026-09-06

Architect bounce (D1, blamed coder): the ticket's own "Shape" constraint
("rate limiting honors 429 retry_after per the engineering guardrails")
was left unimplemented — `coordinator_activity_feed_post.bb` treated every
non-2xx Telegram response identically, never reading a 429's own
`parameters.retry_after`.

## Fix

Ported `extension/src/notify/telegramClient.ts`'s `retryOnRateLimit`
(BL-342) contract to Babashka rather than re-deriving a different shape:
unbounded retry on a 429 that carries its own `retry_after`, an
IMMEDIATE, unretried report for any other failure.

- `swarmforge/scripts/coordinator_activity_feed_post_lib.bb` (new): the
  testable pieces — `extract-retry-after-seconds` (pure JSON-body
  parsing) and `send-with-rate-limit-retry!` (the retry loop itself,
  `post-once!` and `wait-seconds!` both injected — no real Telegram call
  and no real sleep in a test).
- `swarmforge/scripts/coordinator_activity_feed_post.bb`: now a thin
  wrapper — the real `post-once!` (the HTTP call, unchanged shape) and the
  real `wait-seconds!` (`Thread/sleep`) are the only two things it adds
  over the lib.

The daemon's own bounded subprocess chokepoint
(`daemon-cycle-guard-lib/sh!`, 60s default) is the outer safety net for a
truly pathological wait — the retry loop itself is deliberately unbounded
too, matching `retryOnRateLimit`'s own reasoning: giving up is exactly the
failure this contract exists to close.

`tick!`'s own orchestration and tests are unaffected — this bounce is
entirely inside the one `post!` seam already injected, exactly as the
architect's remediation pointer said.

## Checks

- `bb swarmforge/scripts/test/coordinator_activity_feed_post_lib_test_runner.bb`
  (new, registered in `suite-manifest.tsv`): `ALL PASS` — success-first-try,
  429-then-success (one retry, correct wait value), three-consecutive-429s
  (three retries, correct wait values each time), a genuine non-429
  failure (immediate false, zero retries), and a 429 with NO `retry_after`
  in its body (immediate false, never loops forever on an unparseable
  signal).
- `bb swarmforge/scripts/test/suite_inventory_cli.bb swarmforge/scripts/test`:
  ok.
- BL-1427's own load-analyser: clean on both touched/new files.
- Acceptance (GH-24's own feature, unaffected by this bounce): still 5/5.

By coder.
