# BL-572 — architect SEND BACK #2 (2026-07-26)

- **Ticket**: BL-572 epic priority reorder screen on the live Mini App console
- **Bounced commit**: `c02ca6277c` (from cleaner)
- **Blamed stage**: **specifier** (the acceptance criteria are unsatisfiable for
  this ticket's own primary use case — this is not a coder error)
- **Failure class**: `spec`
- **Bouncing role**: architect
- **Prior bounce**: `backlog/evidence/BL-572-architect-bounce1-20260726.md`

## Bounce #1 is FIXED — recorded so the rework does not disturb it

Bounce #1 demanded: *a single move changes the mover's position in the displayed
list by exactly one and leaves every other epic's relative order unchanged,
with the value floor held at 0.* The rework defines the move over SLOT
positions with explicit window boundaries (`lowerLimit`/`upperLimit`) instead
of raw value swaps. **The property now holds.** Verified against TODAY's real
paused-epic list (13 epics, 9 tied at `00`), for all 24 possible moves:

```
ok   BL-594 up:   delta=-1 othersPreserved=true writes=[{"BL-558":1}]
ok   BL-564 up:   delta=-1 othersPreserved=true writes=[{"BL-564":0},{"BL-594":5}]
ok   BL-645 up:   delta=-1 othersPreserved=true writes=[{"BL-645":5},{"BL-564":14}]
ok   BL-552 up:   delta=-1 othersPreserved=true writes=[{"BL-552":14},{"BL-645":20}]
ok   BL-554 up:   delta=-1 othersPreserved=true writes=[{"BL-554":20},{"BL-552":30}]
ok   BL-558 down: delta=+1 othersPreserved=true writes=[{"BL-558":1}]
ok   BL-594 down: delta=+1 othersPreserved=true writes=[{"BL-564":0},{"BL-594":5}]
ok   BL-564 down: delta=+1 othersPreserved=true writes=[{"BL-645":5},{"BL-564":14}]
ok   BL-645 down: delta=+1 othersPreserved=true writes=[{"BL-552":14},{"BL-645":20}]
ok   BL-552 down: delta=+1 othersPreserved=true writes=[{"BL-554":20},{"BL-552":30}]
```

Every move that executes shifts by exactly one position, preserves all other
epics' relative order, and writes no negative value. All three sites from
bounce #1 are closed. Nothing below asks for any of this to change.

## Architecture verdict: PASS (again) — the defect is not structural

- Dependency-rule gate **PASSED** (`dependency-gate.js` over `bridgeServer.ts`,
  `epicReorderSafety.ts`, `epicReorderUiHtml.ts`, `consoleMenuUiHtml.ts`) — no
  forbidden edges.
- Correct surface: LIVE holistic UI (`/epic-reorder`), not the static PWA.
- Auth reuses `requireControlAuth`; writes are `atomicWrite`; the commit goes
  through `commit_integrity_cli.bb`, never a bare `git commit`.
- Pure decision core outside the IO edge, as `expediteSafety.ts` is. No webview
  storage. Compile clean. Both suites green (40/40).
- Co-change: only the known `bridgeServer.ts` hub coupling
  (`bridgeServer.test.js` 23, `steps/index.js` 14, `pausedPagerUiHtml.ts` 7,
  `bridgeAuth.ts` 6). Pre-existing, not introduced here.

## BLOCKING — the acceptance criteria cannot be satisfied for the live backlog

The screen exists to reorder the epic list the human asked to prioritise.
**On today's real backlog, 14 of the 24 possible moves are silently refused**
— including every move of 7 of the 9 epics tied at `00`:

```
FAIL BL-539 up   REFUSED (null)      FAIL BL-517 down REFUSED (null)
FAIL BL-540 up   REFUSED (null)      FAIL BL-539 down REFUSED (null)
FAIL BL-541 up   REFUSED (null)      FAIL BL-540 down REFUSED (null)
FAIL BL-542 up   REFUSED (null)      FAIL BL-541 down REFUSED (null)
FAIL BL-543 up   REFUSED (null)      FAIL BL-542 down REFUSED (null)
FAIL BL-545 up   REFUSED (null)      FAIL BL-543 down REFUSED (null)
FAIL BL-558 up   REFUSED (null)      FAIL BL-545 down REFUSED (null)
```

This is the outcome the ticket's own description names as unacceptable:

> "two adjacent epics with the same value swap to no observable effect, so the
> UI would look stuck. Scenario 02 requires the move to still produce a strict
> ordering."

It is also `qa_e2e_procedure` step 4 failing: set two adjacent epics to the same
priority and move the lower one up — for 7 of the 9 epics at `00`, the list
order does not visibly change.

### The coder did not get this wrong — the spec is impossible

The refusal is deliberate, documented and tested
(`epicReorderSafety.test.js:241`, `computeSlotValues`' own comment). Given the
ticket's three constraints, refusing is the only sound option available:

1. **floor ≥ 0** — `backlog-schema.md` documents `priority` as *"Lower = higher
   priority (e.g. `0` for critical)"*, and `0` is what Expedite writes. Bounce
   #1 required this floor so a reorder cannot outrank Expedite; the ticket's own
   notes require the two actions stay distinct.
2. **only the two swapped epics' files may be written** — scenario 02's *"no
   other epic's backlog YAML is modified"*.
3. priorities are integers.

To transpose two adjacent epics inside a run tied at `0`, the upper one must
sort below the lower one. Tied values break by `id` ascending, so the mover
needs either a value `< 0` (breaks 1) or a third epic must move (breaks 2).
**There is no integer solution.** The impossibility is a property of the
acceptance criteria, not of this implementation — which is why it belongs to the
specifier and not the coder.

### The remedy that appears to fit (specifier's call, not mine)

Amend scenario 02 to let a tie-case move **normalize the tied run**: assign
distinct ascending values across only the epics in that run, preserving every
relative order except the transposed pair. That writes more than two files in
the tie case — the case the ticket already singles out as special — while
keeping scenario 01's exactly-two-files guarantee for the distinct-value case,
keeping the floor at 0, and never touching an epic outside the run. Whatever is
chosen, the criteria must state what happens when a tied run sits at the floor,
because that is the live backlog's actual shape.

## Second defect (coder, once the spec settles) — a refused move reports success

`handleEpicReorderMoveRoute` answers a refused move with
`{success: true, changed: false}` (`bridgeServer.ts`). The UI reads
`payload.success` as "it worked", calls `refresh()`, and renders an identical
list with the status line showing only the epic count — the human gets **no
signal at all** that the tap did nothing. Even if refusal survives as a legal
outcome, `success: true` is the wrong way to report it: `changed: false` needs
to reach the human as a stated reason on the screen.

## Minor note (not blocking, no action required this round)

`readPausedEpics` substitutes `Number.MAX_SAFE_INTEGER` for a missing
`priority:`, and that sort sentinel can reach disk — for
`[BL-100(0), BL-200(none)]`, moving `BL-200` up writes
`priority: 9007199254740991` into `BL-100`'s YAML. Reachable only via a
schema-invalid ticket (`priority` is a **required** field per
`backlog-schema.md`), so it is defensive-path only. Worth closing whenever this
code is next touched; not a reason to hold the parcel.

## Property test

Bounce #1 undertook to encode the positional property as a
`*.property.test.js` over `computeEpicReorder` when the parcel returned. The
property holds (see the probe above), but the module does not exist on `main`,
so the test cannot land ahead of the parcel. It is deferred to the pass, not
dropped — I will add it and show it bites before forwarding to the hardener.

## Reproduction

Worktree-local probe (not committed): loaded compiled
`extension/out/bridge/epicReorderSafety.js`, ran `computeEpicReorder` for every
epic × direction over the real paused-epic list read from
`backlog/paused/*.yaml` (`type: epic`), applied each returned write set,
re-sorted with `sortEpicsByPriority`, and compared the mover's before/after
index plus the relative order of every other epic. Inputs and outputs quoted
verbatim above.
