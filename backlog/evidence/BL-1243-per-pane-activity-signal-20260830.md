# BL-1243 — each Live Screen tile paints its own agent's activity

Coder, 2026-08-30.

## What shipped

`PaneLiveSnapshot` gains `activitySignal?: 'ok' | 'stale' | 'err'`, set by
`derivePaneActivitySignal(paneText)` inside `tryCaptureRolePane` — from the
pane text that same capture already holds. That is the writer BL-1160
deliberately left unbuilt (its reader, `resolvePaneStatusKind`, has been
preferring the field since it landed), so the per-tile path lights up with no
second freshness channel.

## The mapping question the ticket left open, and why the answer was forced

The approval context asks which reading the operator wants: does a genuinely
idle agent read as `ok` (healthy, just not working) or `stale` (nothing is
happening)? I did not get to choose — the feature file and the palette decide
it between them:

- only `ok` / `stale` / `err` exist, and extending them is out of scope;
- scenario 01 requires that two roles polled together CAN differ;
- a busy agent is plainly the healthy one, so busy → `ok`.

That leaves exactly one slot for alive-but-idle: **`stale`**. It reads
honestly too — on this dot `stale` means "nothing is happening here", which for
a pane whose text shows no live turn is simply true, and it is what makes a
grid of dots tell the operator where the work is.

**If the operator wanted idle → `ok`, this ticket cannot deliver it without a
fourth status kind**, which its own constraints forbid. Flagged rather than
quietly assumed; the specifier has the note.

## The one case that needed a decision, found by the acceptance

The two Examples rows of scenario 02 are not the same state:

- **unavailable** — no capture at all. No signal; the snapshot marks the pane
  unavailable and the UI's existing branch hides the dot, exactly as before.
- **never captured** — a capture that came back BLANK. Returning nothing here
  fails: the reader then falls through to the whole-poll aggregate, and a
  fresh poll paints the dead pane green. That is precisely the defect
  invariant 1 names, and the acceptance caught it on the first run.

So a blank capture answers for itself with `stale` — the honest floor, "no
evidence this pane is doing anything" — while a pane with no capture at all
still yields no signal. The distinction is in the writer, so it holds whatever
the caller does with `available`.

## The operator's stop condition, checked rather than asserted

> Can each individual activity dot reflect the activity of the individual
> agent? Is that a big runtime overhead? If so don't do it.

No new capture, no new probe, no poll change. The signal is a pure function of
`paneText` that `tryCaptureRolePane` had already read.

Checked two ways: scenario 04 counts the `capturePane(` call sites on the Live
Screen path (2 — the pane body and the role-search read, both pre-existing) and
greps the writer's own body for process reaches; and invariant 2's property
replaces every `child_process` entry point with a throw and runs the writer 200
times over real captures, random strings, blank and absent input.

## Reuse, not a second definition of busy

`isPaneActivelyProcessing` is the shared predicate — the one BL-1003 aligned
with `chase_sweep_lib.bb`'s own `actively-processing?` after the two sides were
measured disagreeing in both directions. A unit test asserts the signal agrees
with it on every fixture rather than re-deciding busy here.

The fixtures ARE the seven real BL-970 captures both sides are held to, not
hand-typed "busy-looking" strings. The signal reads them:

```
undefined  empty-capture.txt          → stale (blank capture)
stale      idle-bg-shell-running-chrome.txt
stale      idle-quoted-busy-marker.txt
stale      idle-real-qa-4-shells.txt
ok         midturn-esc-footer.txt
ok         midturn-unlisted-verb-no-counter.txt
ok         midturn-unlisted-verb-real-capture.txt
```

`idle-quoted-busy-marker.txt` reading `stale` matters: a bare substring match
would have called it busy, which is the false-busy half of BL-1003.

## The declared invariants (BL-654)

`extension/test/bl1243PaneActivityInvariants.property.test.js`.

Invariant 1 is stated as an IMPLICATION over the real reader — if a tile paints
ok, that ok came from the pane's own signal — with the aggregate drawn
adversarially including `ok`, because an aggregate that is never green cannot
expose the defect at all. Reach is by construction over the four pane shapes
that exist (busy, idle, blank, uncaptured), each floored; random strings would
have spent nearly every run on "idle".

Invariant 2 is behavioural, not a grep: every `child_process` entry point is
replaced with a throw for the duration.

**Non-vacuity, both by breaking the code and running:**

| break | result |
|---|---|
| the writer sets no signal (the BL-1160 state) | invariant 1 FAILS: "a busy pane painted ok on a signal it did not derive from itself (aggregate ok)" and "both tiles painted alike" |
| the writer shells to tmux | invariant 2 FAILS: "the per-pane signal reached for child_process.spawnSync" |

Restored; 4/4 green.

## The acceptance drives the real reader

`resolvePaneStatusKind` lives inside a browser-source string in
`residentSpyUiHtml.ts`. The step handlers lift that function out and evaluate
it, rather than restating its rule — a hand-written copy would be a second rule
free to drift from the one that actually paints the dot, which is the class of
defect this ticket exists to close.

## Runs

| what | result |
|---|---|
| BL-1243 unit tests | 7/7 |
| BL-1243 property tests | 4/4 |
| BL-1243 acceptance | 6/6 |

## Out of scope, untouched

No new probe or heartbeat, no new status meanings, no poll-rate change, no
Bubble port, and nothing in the static backlog-dashboard PWA — this is the LIVE
holistic UI only.

## Specifier amendment, 2026-08-30 — the mapping ruled, and scenario 06

The mapping question above is **ruled as built**: idle reads `stale`. No fourth
status kind.

The same amendment added scenario 06, and it names a real defect this parcel
would otherwise have shipped. `residentSpyUiHtml.ts` repaints the LAST
snapshot's panes when a poll FAILS, and `resolvePaneStatusKind` consulted the
per-pane signal before anything else — so a tile that was busy at the moment the
bridge went down would have stayed green for the whole outage. The one event the
operator most needs the grid to stop claiming things about is exactly the one it
would have kept claiming through.

A failed poll now outranks every per-pane signal. Scoped to `err` deliberately,
per the scenario's own wording: a merely STALE aggregate still yields to the
pane's own answer, because "the poll is a bit old" is not "we have lost
contact".

Covered three ways: scenario 06 through the real reader; a unit test that pins
all three aggregates against a busy pane (`err` → err, `stale` → ok, `ok` → ok);
and invariant 1's property, which now asserts the failed-poll clause for every
pane shape and carries its own reach floor so the clause cannot go unexercised.

Acceptance 7/7, unit 8/8, property 4/4.

## QA bounce, 2026-08-30 — D1-D4, and why the parcel QA read was already stale

QA's inventory is correct about the commit it read (`c339946666`, the
documenter's) and every item is already fixed on this branch. The four defects
are the three halves of the specifier's scenario 06 plus its doc entry, and
they were closed in `06f6feacd` — a commit made after QA's parcel left the
coder, so QA could not have seen it. QA's own tracing says as much: the
amendment `2f36d2270` is not an ancestor of the architect's or the hardener's
commits, and nobody between them re-ran acceptance against the amended feature.

Verified against this branch rather than assumed, item by item:

| item | state here |
|---|---|
| D1 `resolvePaneStatusKind` never checks `err` first | fixed — `residentSpyUiHtml.ts:807`, `if (aggregateKind === 'err')` before the per-pane early return |
| D2 scenario 06 has no step handler | fixed — the `When` handler is registered |
| D3 the reused `Then` hardcodes the `ok` aggregate | fixed — it reads `ctx.bl1243.aggregate`, defaulting to `ok` only when a scenario supplies none |
| D4 Specification.MD documents a fix that does not exist | the fix now exists, so the entry is true |

Acceptance **7/7** on this branch, against QA's measured 6/7.

**One doc inaccuracy D4's remediation note anticipated, corrected here.** The
entry said "unavailable or never captured → no per-pane signal at all", and its
very next sentence then says a blank capture answers `stale`. Both halves are
about a pane with no usable text and they contradicted each other. The clause
now reads "unavailable, meaning no capture at all → no per-pane signal", with
the blank capture named as the other half. QA routed D4 to the coder under
"code AND docs both defective → the earlier of the two", and this is the
smallest correction that makes the sentence describe what ships.
