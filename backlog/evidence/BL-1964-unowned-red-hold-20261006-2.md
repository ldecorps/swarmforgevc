# BL-1964 QA hold on an unowned red, second hold (2026-10-06)

parcel_commit: f3f32fb05a
red: extension/test/bl1905RealDispatcherScan.property.test.js

Resume of the first hold (`BL-1964-unowned-red-hold-20261006.md`, parcel 9847fb86de,
red extension/test/tmuxReaperGuard.test.js). The specifier's note 002394 named its fix,
hotfix aeb9771b84. QA retook 914e16e7a1 and merged origin/main adc5303ef1 (sync merge
f3f32fb05a, diffed against both parents: parent 1 loses only main's deliberate removals,
BL-2023 4b4888d4ce and the BL-1625 split b3b36584af; parent 2 gains only BL-1964's own paths).

## The parcel's own gates, all clean

qa-gather at f3f32fb05a, one run: sibling VERIFY; register exit 0 (4 rows, all owned,
unowned []); pre_qa_gate (required_wiring) OK; unit exit 0 (the tmuxReaperGuard red is
gone); acceptance BL-1964 pass 2 fail 0. Stragglers after the run belong to the coder2
worktree's own vitest run, not to QA.

## The red (property lane, `npm run test:properties`, one run, 741 s)

Not caused by this parcel. The parcel changes neither the test nor
`specs/pipeline/steps/lib/realDispatcherScan.js`. The scan it relies on flags nothing over
the real step tree, BL-1964's own `bl1964CoordinatorResolvesToNoWakeSessionSteps.js`
included: `scanDir().filter(r => r.flagged.length)` returns [] at f3f32fb05a. No row in
backlog/standing-reds.tsv, the property allowlist or suite-poles names the file. No open
ticket mentions it: the only backlog hits are BL-1905's own coder evidence and QA's BL-1945
and BL-1947 passes, all closed. register_join:
`{"file":"extension/test/bl1905RealDispatcherScan.property.test.js","join":"absent"}`.

Verbatim, as far as it was captured: the gather's register join parsed the lane's FAIL line
`FAIL test/bl1905RealDispatcherScan.property.test.js`. The gather keeps only a 4000-char
tail excerpt of the lane, and that tail is entirely BL-871's allowlisted
`Error: [vitest-worker]: Timeout calling "onTaskUpdate"` blocks. The assertion or timeout
text of the failing test was therefore NOT captured, and the one-run rule forbids re-running
the lane to get it.

What is measured: a single solo run of the file to read its assertion
(`npx vitest run --config vitest.properties.config.mjs test/bl1905RealDispatcherScan.property.test.js`,
log tmp/BL-1964-bl1905-single.log) PASSED 2/2. Part 1 ("no handler in specs/pipeline/steps
starts a real receive or completion dispatcher") took 19621 ms of its 60000 ms budget,
alone on the host. The lane ran concurrently with the coder2 worktree's own
`npm run test:properties`. That is consistent with a load-relative timeout of part 1, but
the message that would prove it was not kept, so this is NOT recorded as "flaky".

Tool gap, for whoever owns it: qa-gather's register join reads the whole lane output
(BL-1769), but the gather saves only the 4000-char excerpt. A red's verbatim message
(BL-1509's evidence rule) is lost whenever the lane's tail is noise.

Resume: once an owner exists, re-run the gate on f3f32fb05a (merge main first if it moved)
against the register as it then stands, approve and queue the land, then
`qa_hold_cli.bb close --task BL-1964 --outcome approved`.
