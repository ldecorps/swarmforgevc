# GH-24 — architect bounce, 2026-09-06

## D1

- **Violated requirement**: the ticket's own `description:` "Shape" section
  states as a constraint: "rate limiting honors 429 retry_after per the
  engineering guardrails." `engineering-detailed.prompt` states the same
  guardrail ("Rate-limited external syncs: honor 429 `retry_after`...") with
  a named precedent to copy: `extension/src/tools/backfill-topic-icons.ts`'s
  `editForumTopicWithRateLimitRetry` (BL-342) — on a 429, wait EXACTLY the
  server-told `retry_after` seconds (never a generic guess/backoff) and
  retry the SAME call; a genuine (non-429) failure is reported, not retried.
- **Reviewed commit**: 2d842b5b60 (coder), unchanged by the self-audit fix
  (6d7a622457) which addressed a different issue (cursor sort key).
- **Observed**: `swarmforge/scripts/coordinator_activity_feed_post.bb`
  treats EVERY non-2xx Telegram response identically — it prints the status
  and exits 1, never reading the response body's `parameters.retry_after`
  field, never waiting, never distinguishing a 429 from any other failure.
  `daemon_cycle_guard_lib.bb`'s `sh!` (the subprocess chokepoint handoffd.bb
  shells through to reach this script) is a generic bounded-timeout wrapper
  with no Telegram-specific semantics — confirmed by reading its definition;
  no 429 handling exists anywhere in this call chain.
- **Consequence**: `tick!`'s drop/deliver/fail gate stops the WHOLE tick on
  first failure and retries next daemon sweep cycle — but that retry is on
  the daemon's OWN fixed cadence, not on the value Telegram itself told the
  caller to wait. On a first-tick backfill (a coordinator's mailbox/commit
  history with many unposted traces, the exact scenario the engineering
  guardrail calls out) hitting a 429 mid-burst, the surfacer will keep
  retrying at the daemon's cadence and can re-trigger the same 429 instead
  of backing off by the server-told duration — the "silently dropped /
  hammered" failure class BL-342 was written specifically to close, now
  reopened in a second, undocumented location.
- **Failure class**: behavior (a stated ticket constraint left unimplemented).
- **Blamed role**: coder.
- **Remediation pointer**: `coordinator_activity_feed_post.bb`'s failure
  branch should parse the JSON response body's `parameters.retry_after` on
  a 429 status, sleep exactly that many seconds, and retry the same POST
  once (or loop, matching BL-342's "unbounded for 429 only, immediate
  report for anything else" shape) before returning its exit code — the
  `tick!` orchestration and its own tests are otherwise unaffected, since
  this is entirely inside the one `post!` seam already injected.

Everything else in the full checklist (both invariants implicit in the
ticket's own description — additive/non-blocking to the coordinator, zero
coordinator LLM tokens, no new daemon/cadence; the drop/deliver/fail gate;
the two independent cursors and the priority-sort-key fix; the acceptance
feature 5/5; `check_bb_scripts_load.sh --all` clean with `handoffd`
booting; the unit suite; scope — out-of-scope items confirmed untouched)
was reviewed and found correct. This is the one finding.

By architect.
