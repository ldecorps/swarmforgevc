# BL-339 recert-notify-and-deep-link-via-telegram — 20260713 (architect)

## Verdict: PASS, forwarded to hardener (merge commit e8e82bdee2)

## What was reviewed

Merged cleaner's `e0a541069d` (CRAP-reduction: `main()`/`readState()` in
`notify-recert-batch.ts` now covered in-process instead of only via
subprocess, per the CLI main()-thin-wrapper rule) on top of coder's
`be6ae34c` into the architect worktree, then reviewed the combined parcel.

## Hard gate: dependency-gate.js

Ran (from `extension/`, relative paths — the tool errors on repo-root-
relative paths):

```
node out/tools/dependency-gate.js \
  src/metrics/pwaDeepLinks.ts \
  src/notify/recertBatchNotifier.ts \
  src/tools/notify-recert-batch.ts \
  test/notifyRecertBatchCli.test.js \
  test/pwaDeepLinks.test.js \
  test/recertBatchNotifier.test.js
```

Result: `Dependency-rule gate PASSED: no forbidden edges.` (exit 0)

## Logical coupling: co-change-report.js

Ran against all parcel-changed files (extension src/test, `pwa/app.js`,
`swarmforge/scripts/handoffd.bb`, `specs/pipeline/steps/recertNotifySteps.js`).
No NEW suspected coupling (≥3, the tool's default threshold) is introduced
by this ticket. `pwa/app.js` and `handoffd.bb` do show pre-existing
SUSPECTED COUPLING against many other files — both are already-known large,
frequently-touched files (dashboard/locale/hash-routing on the `pwa/app.js`
side; the daemon's many `*-sweep!` adapters on the `handoffd.bb` side) and
this ticket's own additions are one more thin adapter/route in an existing
pattern, not a new structural coupling. This ticket's own new files
(`pwaDeepLinks.ts`, `recertBatchNotifier.ts`, `notify-recert-batch.ts`,
their tests, `recertNotifySteps.js`) co-change only with each other and the
evidence file at frequency 1 — expected for a same-commit ticket, not a
signal.

## Boundary checks

- `notify-recert-batch.ts` (CLI/adapter) depends inward on
  `decideRecertAnnouncement`/`buildRecertAnnouncementText` (pure policy,
  `recertBatchNotifier.ts`) and `buildRecertDeepLink` (pure,
  `pwaDeepLinks.ts`) — never the reverse. Confirmed by the dependency-gate
  pass above (no forbidden edges) plus direct read.
- Telegram `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` read from
  `process.env` only in the Node CLI — never written to the target working
  directory or any commit.
- `pwa/app.js`'s change is pure presentation: parses a `#recert=1` hash
  fragment and calls `scrollIntoView()` on an existing DOM node; no
  `localStorage`/`sessionStorage` added.
- `handoffd.bb`'s wiring shells to the compiled CLI exactly like its
  sibling `*-sweep!` adapters (same `process/sh` call shape, same
  `try`/`catch` degrade-to-no-op-and-log posture) — no new coupling to the
  live, currently-running Telegram Front Desk Bot process
  (`front_desk_supervisor.bb`'s `spawn-bot!`); this is a disposable,
  independent CLI per the coder's own documented design decision.

## Correctness check (BL-333/BL-345 lesson)

`writeState()` (which persists `announcedIds`, the anti-spam arming state)
is only called after `result.success` on the send path — confirmed by
reading `main()` directly. This is the "arm on CONFIRMED DELIVERY, never on
a delivery ATTEMPT" rule from `engineering.prompt`, correctly reapplied
verbatim, with no discarded send result.

## Scope-boundary check

Grepped `confirmScenario`'s call sites: its only caller anywhere in
`extension/src` is `recertification.ts` (the existing inbound-email verdict
path, BL-223). `notify-recert-batch.ts` has zero reference to it — no
verdict-via-Telegram path exists, matching the ticket's explicit
out-of-scope note.

## Build

`npm install` (no new deps) + `npm run compile` — clean, no errors, before
running the gate tools (stale-`out/` gotcha avoided).

No violations found. Forwarded to hardener with the same task name.
