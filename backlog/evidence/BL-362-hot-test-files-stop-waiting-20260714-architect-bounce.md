# BL-362 architect review — 20260714

## Verdict: BOUNCE to coder — known-open acceptance gap not actually fixed, and the claimed descope is unverifiable

## What was reviewed

Merged cleaner's `70147e196f` (coder's QA-bounce follow-up `7dfec56fe9`, itself
built on the earlier tick-injection commit `ed1012fe`) into the architect
worktree. Architecturally this is clean: `getPanePidAndCommand` is a
straightforward tmuxClient adapter addition, `PaneTailer` calls it correctly,
`dependency-gate.js` passes with no forbidden edges on all three changed TS
files, and co-change coupling is the expected paneTailer/swarmPanel/tmuxClient
cluster — nothing new or suspicious. The cleaner's own fix (retargeting two
stale `getPaneCommand` mocks to `getPanePidAndCommand`) is correct and closes
a real "mock silently goes dead, real tmux spawn happens" gap.

## The defect

QA already bounced this ticket once (`backlog/evidence/BL-362-hot-test-files-
stop-waiting-bounce-20260714.md`, commit `1f5a6b10`) for failing its own
Scenario 5 acceptance criterion — "The two files get materially faster
without losing a single assertion" — specifically for
`extension/test/paneTailerClass.test.js`, which showed only ~4% delta (noise)
after the tick-injection fix.

**That defect is still not fixed.** I re-ran the same isolated measurement QA
used, twice, against the commit in hand:

```
npx vitest run test/paneTailerClass.test.js
  -> 21 tests, 3481ms
  -> 21 tests, 3518ms  (repeat run)
```

QA's own bounce measured 3464-3607ms pre-this-fix. The coder's follow-up
(`7dfec56fe9`, halving the two `display-message` calls per poll into one) is
a real production efficiency win and is correctly implemented, but the
coder's own commit message says outright: "this fix does not change
paneTailerClass.test.js's wall-clock time either, same as the tick-injection
fix" — and traces the actual dominant cost to a ~70-100ms-per-test fixed tax
from `applyPaneSettings()` (4 more real tmux spawns), which this parcel does
not touch. My re-measurement confirms the commit message's own admission:
Scenario 5 remains unmet for this file.

## Why this is a bounce, not a pass with a note

The coder's commit message states the human gave direct sign-off, in-session,
to treat Scenario 5 as satisfied by `dependencyGateCli.test.js`'s genuine
~55% reduction alone, and to leave `paneTailerClass.test.js` unfixed as an
out-of-scope follow-up. I cannot verify that claim from anything committed:

- `backlog/active/BL-362-hot-test-files-stop-waiting.yaml` is unchanged since
  its `paused -> active` promotion (`git log` on the file shows exactly one
  commit, `f869a24e`) — `human_approval:` still reads `pending`, and Scenario
  5's acceptance text is still the original "materially faster" wording, not
  narrowed.
- No `backlog/evidence/` file, specifier note, or spec-amendment commit
  documents the decision. Per `workflow.prompt`'s "Amending An In-Flight
  Ticket's Spec": a legitimate scope change while a ticket is in flight is the
  **specifier's** action — write it to `main`, notify the parcel's current
  holder — not an unrecorded claim inside a coder commit message.
- QA's own bounce evidence closes with "shipping it unfixed against the
  ticket's own stated 'drop to milliseconds' bar is not something QA can wave
  through silently" — forwarding this parcel now would let exactly that
  happen one stage later, on a claim I have no way to check.

This is the same shape as the architect role's own standing rule: a
correctness/process defect spotted in review is a send-back, not something to
wave through with a note. Whether or not the human really said this, the
mechanism for it to bind the pipeline is a specifier-owned spec amendment
with a durable trail — not a unilateral coder assertion.

## Suggested remediation (not prescriptive — coder's/specifier's call)

Either:
1. Land the actual fix: an injectable tmux-command facade on `PaneTailer` (the
   coder's own commit names this as the real fix, "touching production code
   and its one caller, `swarmPanel.ts`") so `paneTailerClass.test.js` stops
   paying real subprocess-spawn cost per test and genuinely drops toward
   milliseconds, matching Scenario 5 as written; or
2. Get the **specifier** to formally amend `BL-362`'s acceptance criteria
   (commit to `main`, note to whoever holds the parcel) to narrow Scenario 5
   to `dependencyGateCli.test.js` only, with the human's decision recorded
   somewhere durable — then this parcel can be re-reviewed against the
   amended contract.

Bouncing to coder; not forwarding to hardener. Not filing as a
`rule_proposal` instead — this is a live, reachable gap in the parcel itself
(BL-333 lesson).

By architect.
