# GH-24 — coder pass, 2026-09-06

## What was implemented

A deterministic surfacer that posts the coordinator's activity as compact
lines to its own standing Telegram topic, zero coordinator LLM tokens:

- `swarmforge/scripts/coordinator_activity_feed_lib.bb` (new): the pure
  decision lib — trace selection since a persisted per-source cursor
  (`new-handoffs`, `new-commits`), bookkeeping-commit-subject parsing
  (`parse-bookkeeping-subject`, the two shapes coordinator bookkeeping
  produces: `Close <ticket>: move to done. By coordinator.` and
  `Promote <ticket>: paused → active for <role>`), line formatting
  (`format-handoff-line`/`format-commit-line`), and the `tick!`
  orchestration with every IO edge (mailbox read, git log, Telegram send,
  cursor read/write) injected — never live Telegram in a test.
- `swarmforge/scripts/coordinator_activity_feed_post.bb` (new): the actual
  Telegram send, as its own small standalone CLI rather than an HTTP call
  inside handoffd.bb's own long-running process — handoffd shells out to it
  through `daemon-cycle-guard-lib/sh!`, the one bounded subprocess
  chokepoint every in-cycle call in that file already goes through.
  Resolves the coordinator's topic id from the EXISTING
  `.swarmforge/operator/role-topic-map.json` (the same standing-topic
  infrastructure `telegramTopicDecisions.ts`'s `decideEnsureRoleTopicAction`
  reads on the TS side, BL-709) — no new topic-map invented.
- `swarmforge/scripts/handoffd.bb`: wired into the EXISTING sweep cadence
  (`coordinator-activity-feed-sweep!`, registered via `run-sweep!` right
  next to `post-qa-branch-sweep`) — no new daemon, no separate timeout.
  Reads the coordinator's own `sent/` mailbox for handoff traces and a
  bounded (`-n 500`) `git log --reverse` of `main` for bookkeeping commits.
- `specs/features/GH-24-coordinator-activity-telegram-feed.feature`
  (materialized from the parked `.feature.draft`, per the ticket's own
  "Making the contract executable" section — content unchanged, only the
  `.draft` suffix dropped) and
  `specs/pipeline/steps/gh24CoordinatorActivityTelegramFeedSteps.js` (new),
  driving the real lib through a small JSON-in/JSON-out acceptance driver
  (`specs/pipeline/steps/lib/gh24CoordinatorActivityFeedCli.bb`, new) —
  never a reimplementation. The ticket's `acceptance:` field repointed from
  the `.draft` path to the real `.feature` path in the same parcel, per its
  own explicit instruction.
- `swarmforge/scripts/test/coordinator_activity_feed_lib_test_runner.bb`
  (new), registered in `suite-manifest.tsv`.

## Design choices worth recording

- **Two independent cursors** (handoff filename, commit sha), not one
  unified ordering — a filename and a sha are not comparable, and
  interleaving them into one global sequence would only buy an
  approximate "who happened first" the ticket does not ask for. Each
  source's cursor advances only past what was actually posted.
- **Drop/deliver/fail gate**: `tick!` posts traces in order (handoffs
  before commits) and stops at the FIRST failed send, persisting the
  cursor as of the last SUCCESS — the next tick retries the failed trace
  first, before anything later. No trace is ever posted twice.
- **Bookkeeping commit identification is by subject text, not by author**:
  every agent (and the human) share the git author `t <t@t>`, so the two
  known coordinator-bookkeeping subject shapes are what's matched, never
  authorship.
- **First-tick / cold-start**: `list-bookkeeping-commits` is bounded to
  the last 500 commits on `main` rather than the whole repository history
  — a cursor only ever needs to look back as far as the last tick, and an
  unbounded walk would grow with the repository forever for no benefit a
  bounded one does not already give.

## Self-audit finding, fixed before forwarding

Caught on re-review, before the send: `new-handoffs`' cursor comparison
originally compared raw sent-handoff FILENAMES lexically
(`<priority>_<timestamp>_<sequence>_from_...`). The coordinator sends at
several different priorities (00/10/50 all observed in this swarm's own
mailbox) — a priority-00 filename sorts lexically before a priority-50
one regardless of which was actually created later, so once the cursor
passed a lower-priority-numbered file, a genuinely LATER higher-priority
file could be silently skipped forever. Fixed with `handoff-sort-key`
(drops the fixed 3-character priority prefix, comparing only
`<timestamp>_<sequence>`, correctly chronological independent of
priority) — used consistently for both the cursor filter and every
sort-by call site (`handoffd.bb`'s real mailbox listing, the acceptance
CLI driver's fixture). Non-vacuity proven by hand: reverted to the raw
filename comparison, confirmed the new regression test ("a later
priority-00 file is still found new after a cursor at an earlier
priority-50 file") fails exactly as expected, restored (byte-identical
via diff), reconfirmed all tests and the acceptance suite green again.

## Checks run

- `bb swarmforge/scripts/test/coordinator_activity_feed_lib_test_runner.bb`:
  `ALL PASS`.
- Acceptance (`specs/pipeline/scripts/run_acceptance.sh` on the
  materialized feature): 5/5.
- `bb swarmforge/scripts/test/suite_inventory_cli.bb swarmforge/scripts/test`:
  `suite inventory: ok`.
- BL-1427's own load-analyser (`BB_LOAD_ANALYSE_TARGET=<file> bb
  bb_load_analyse_driver.bb`, the same reader-and-eval-without-running-main
  check `check_bb_scripts_load.sh` uses at commit time), run by hand
  against all three touched/new `.bb` files individually, including the
  large `handoffd.bb`: clean on every one.

## Out of scope, confirmed untouched

- Coordinator LLM self-reporting (rejected by the ticket's own
  `approval_context`, human did not override).
- Surfacing any role's activity besides the coordinator's.
- `handoffd`/daemon sweep actions themselves (chases, other sweeps) — not
  the coordinator's own acts.
- Multi-swarm Telegram group separation (named open gap, separate ticket).
- `specs/pipeline/steps/index.js`: NOT touched. The ticket's own
  `required_wiring:` entry (dated 2026-08-30, "repointed 2026-09-04 after
  BL-1371 discovery") already supersedes the older "register it in
  index.js" line inside `description:` — the handler file IS the
  registration; index.js names nothing. Same convention followed on every
  other ticket materializing a `.feature.draft` this session (BL-1226,
  BL-1409, BL-1426).

By coder.
