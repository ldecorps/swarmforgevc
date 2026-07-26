# BL-572 — architect SEND BACK #1 (2026-07-26)

- **Ticket**: BL-572 epic priority reorder screen on the live Mini App console
- **Bounced commit**: `d3ab0409f4` (from cleaner)
- **Blamed stage**: coder
- **Failure class**: `behavior`
- **Bouncing role**: architect

## Architecture verdict: PASS — the defect is not structural

Everything the ticket asked the architecture to get right, this parcel gets
right. Recording it so the rework does not disturb any of it:

- Dependency-rule gate **PASSED** (`dependency-gate.js` over
  `bridgeServer.ts`, `epicReorderSafety.ts`, `epicReorderUiHtml.ts`,
  `consoleMenuUiHtml.ts`) — no forbidden edges.
- Correct surface: the LIVE holistic UI (`/epic-reorder` served by
  `bridgeServer.ts`), **not** the static PWA. The project's two-phone-surfaces
  rule is honoured.
- Auth reuses `requireControlAuth` — no second auth notion invented.
- Writes are `atomicWrite`; the commit goes through `commit_integrity_cli.bb`,
  never a bare `git commit` from the bridge. Scenario 06 is genuinely
  load-bearing (real bridge, real git fixture, real `.bb` chain, asserts
  `backlog/` clean and both ids in the commit subject) — the BL-490
  uncommitted-mutation failure mode is really closed.
- Pure decision core (`epicReorderSafety.ts`) sits outside the IO edge, as
  `expediteSafety.ts` does. No webview storage. Compile clean.
- Co-change report: only the expected `bridgeServer.ts` hub coupling
  (`bridgeServer.test.js`, `steps/index.js`, `pausedPagerUiHtml.ts`,
  `bridgeAuth.ts`). Nothing new or surprising.

## The defect — one property, violated at every site of the write derivation

**Property:** *a single move changes the selected epic's position in the
displayed list by exactly one, and leaves the relative order of every other
epic unchanged.*

`computeEpicReorder` derives its writes as if `priority` were the total order
key. It is not: `sortEpicsByPriority` breaks ties by `id` ascending, so
`priority` is only a **partial** order key. Writing a value that some third
epic already holds silently reorders that third epic against the mover. Both
branches of the derivation do this.

### Site 1 — tie branch, `up` (`epicReorderSafety.ts:57-59`)

`selected = neighborPriority - 1`. Against **today's real backlog** (nine of
thirteen epics are at `priority: 00`):

```
before: BL-517 BL-539 BL-540 BL-541 BL-542 BL-543 BL-545 BL-558 BL-594 BL-564 …
move BL-594 UP  ->  writes [{"id":"BL-594","priority":-1}]
after : BL-594 BL-517 BL-539 BL-540 BL-541 BL-542 BL-543 BL-545 BL-558 BL-564 …
        index 8 -> index 0        *** eight positions, not one ***
```

The nudge lands below the *entire* tied run, so the mover teleports to the top
of the list. This is the first thing the screen does on first real use.

### Site 2 — tie branch, `down` (same lines)

`selected = neighborPriority + 1`, symmetric:

```
move BL-517 DOWN -> writes [{"id":"BL-517","priority":1}]
after : BL-539 BL-540 BL-541 BL-542 BL-543 BL-545 BL-558 BL-594 BL-517 BL-564 …
        index 0 -> index 8        *** eight positions, not one ***
```

### Site 3 — distinct-value swap branch (`epicReorderSafety.ts:54-56`)

Not only the tie branch. A plain swap whose swapped-in value collides with a
third epic reorders that third epic too:

```
before: BL-900(10) BL-100(20) BL-200(20)
move BL-100 UP -> writes [{"id":"BL-100","priority":10},{"id":"BL-900","priority":20}]
after : BL-100(10) BL-200(20) BL-900(20)
        mover BL-100      1 -> 0   (correct)
        displaced BL-900  0 -> 2   *** fell two ***
        bystander BL-200  2 -> 1   *** rose one, never written ***
```

Moving BL-100 up silently demoted BL-900 below an epic nobody touched.

### Consequence worth naming — `priority: -1` is out of band

The tie nudge writes negative priorities. `swarmforge/backlog-schema.md`
documents `priority` as *"Lower = higher priority (e.g. `0` for critical)"* —
`0` is the floor, and it is exactly the value Expedite writes to mean "jump
the queue". A reordered epic at `-1` now outranks an expedited ticket. The
ticket's own notes say the two actions must stay distinct; this collapses them
in the reorder screen's favour. With nine epics already at `00`, this is
reachable on the first tap, and repeated moves walk further negative.

## Why the green suite is not evidence here

Both suites pass (25/25) against all three sites:

- The acceptance assertion is **file-scoped** — *"no other epic's backlog YAML
  is modified"*. In site 3, BL-200's file genuinely is not written; only its
  *order* changed. The scenario cannot see it.
- The unit tie tests assert only a **pairwise** relation — *"strictly below its
  new neighbour above"* — never the mover's resulting **index** in the full
  list. `epicReorderSafety.test.js:88,98,108` all stay green while the mover
  teleports.

Whatever the fix is, it needs an assertion over the *resulting index in the
whole list*, not over a value pair.

## Remediation

Define the move over **position**, not over raw value: a move must produce a
write set such that re-sorting by `(priority, id)` places the mover exactly one
position from where it started and preserves every other epic's relative order
— including when the mover sits inside a run of ties, and including when a
swapped-in value is already held elsewhere. Keep the value floor at `0` so the
screen cannot outrank Expedite.

Fix the class, not the three instances. When it returns I will encode this
property as a `*.property.test.js` over `computeEpicReorder` (it is an
undeclared property on a pure module, so it is mine, not the coder's) and
confirm it bites before passing.

## Reproduction

Probe used (worktree-local, not committed): loaded compiled
`extension/out/bridge/epicReorderSafety.js`, applied `computeEpicReorder`'s
writes to the input list, re-sorted with `sortEpicsByPriority`, and compared
the mover's before/after index. Inputs are quoted verbatim above.
