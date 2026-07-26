# BL-672 — architect SEND-BACK #1

- Ticket: `BL-672-epic-make-top-priority-button`
- Reviewed commit: `0ada474942` (cleaner batch tip); BL-672's own work is `2af1e046b`
- Verdict: **SEND BACK to coder.** Architecture PASS; one correctness defect.
- Failure class: `behavior`

## DEFECT — the ticket's headline verb is unreachable in exactly the case it exists for

`extension/src/bridge/epicReorderUiHtml.ts:165`

```js
html += '<button class="make-top" data-id="' + item.id + '"' + (disableUp ? ' disabled' : '') + '>Make top</button>';
```

`disableUp` is `index === 0` (line 154) over `data.items`, and `data.items` comes
from `computeEpicReorderState` → **`readPausedEpics`** — `backlog/paused/` only,
`.filter(item => item.type === 'epic')`.

But the make-top ROUTE's domination set is **`readLiveBacklogItems`** —
`paused` + `hold`, epics **AND** non-epic topics (the specifier's
`approval_context` #3, and the whole point of the operator's ask).

The two sets are different, so `index === 0` does NOT mean "already the top of
the live backlog". Whenever a live **topic** or any **`hold/` item** currently
outranks the best-ranked paused epic, the route would perform a real,
dependency-free rewrite — and the button is greyed out, so the operator cannot
tap it. The one state the operator described wanting fixed ("every topic ends up
at a lesser priority") is the one state the control is disabled in.

### Repro, run against the compiled modules (not inspection)

```js
const live = sortEpicsByPriority([
  { id: 'T1', priority: 1, type: 'topic', dependsOn: [] },  // a paused TOPIC outranks every epic
  { id: 'E1', priority: 2, type: 'epic',  dependsOn: [] },  // best-ranked epic
  { id: 'E2', priority: 3, type: 'epic',  dependsOn: [] },
]);
const screenItems = sortEpicsByPriority(live.filter(i => i.type === 'epic')); // readPausedEpics' shape
```

```
screen items (epics only): E1@2, E2@3
E1 index on screen        : 0 -> Make top button disabled = true
route verdict for E1      : {"writes":[{"id":"T1","priority":2},{"id":"E1","priority":1}],"changed":true}

CONTRADICTION: the route would make a real, dependency-free change, but the button is disabled.
```

### Reachability — latent today, one ordinary operator action away

Against the real backlog right now (112 paused files / 15 paused epics / 4 hold
items), the top epic `BL-517` sits at `priority 0` and genuinely IS the unique
live top, so the route agrees with the disable (`changed:false`, "Already the
unique top of the live backlog"). The defect is therefore **latent, not
currently firing** — and it starts firing the moment any live topic or hold item
is given a better priority than the best epic. That is routine: `main`'s own log
carries "Operator: BL-574 … to priority 01" from today.

### Two things that make this an accident rather than a decision

1. **The parcel is internally inconsistent about it.** BL-673's topic-level
   "Make top" button (`epicReorderUiHtml.ts:207`) has **no** `disabled`
   attribute at all — it lets the route answer `changed:false` with its stated
   reason, which is the correct pattern and the one the response contract was
   built for (BL-572 architect bounce #2/#3).
2. **Nothing sanctions the disable.** Neither
   `specs/features/BL-672-epic-make-top-priority.feature` nor
   `extension/test/epicReorderUiHtml.test.js` asserts the button's
   enabled/disabled state anywhere, so no scenario is protecting this behaviour.

### Fix direction (coder's call, two clean options)

- **Drop the disable** on the make-top button, matching BL-673's topic button:
  the route already returns `changed:false` + `reason` ("Already the unique top
  of the live backlog"), and the UI already displays it via
  `handleActionResponse`. Cheapest, and consistent within the same file.
- **Or** have `computeEpicReorderState` emit a per-item flag derived from the
  LIVE set (it already computes `readLiveBacklogItems` for BL-674's dependency
  marker — `liveItems`/`liveIds` are right there) and disable on that instead of
  on `disableUp`.

Either way, add the missing coverage: an assertion that the make-top control is
usable for an epic that leads the epics list but is outranked in the live set.

## Full-parcel sweep for this same class

Per one-bounce-per-property: every other UI precondition in the file was checked
against its own route's set.

| site | control | disable rule | route's set | verdict |
|---|---|---|---|---|
| `:163` | Move up | `index === 0` over epics | move route reads `readPausedEpics` (epics only) | **matched — correct** |
| `:164` | Move down | `index === total-1` over epics | same | **matched — correct** |
| `:165` | Make top (epic) | `disableUp` over epics | `readLiveBacklogItems` (paused+hold, all types) | **MISMATCH — the defect** |
| `:207` | Make top (topic, BL-673) | none | topic route | **correct pattern** |

`:165` is the only site. This is one defect, not a class with multiple instances.

## What PASSED — do not redo any of it

- **Architecture: PASS.** Pure decision core (`makeTopPrioritySafety.ts`) is
  filesystem-free and git-free, paths in / writes out, same testable-core
  boundary as `epicReorderSafety.ts`. The position change reuses
  `computeEpicReorder`'s adjacent-swap primitive one slot at a time rather than
  re-deriving cascade math a fourth time — the right call after BL-572's three
  bounces, and I checked the reuse is sound: each `'up'` step assigns the
  neighbour a value that `ordersAfter` the target's new value, so every
  iteration strictly decreases the target's index — `walkToIndex` makes
  progress and terminates, no spin in a live request handler. Net-write
  accumulation cannot produce `changed:true` with an empty write set (order is a
  function of `(value, id)`, so a changed order implies at least one changed
  value).
- **Dependency-rule gate (REQUIRED, BL-259):** full-repo scan —
  **PASSED, no forbidden edges.**
- **`required_wiring`, both entries have live callers:**
  `isEpicMakeTopRoute`/`handleEpicMakeTopRoute` is registered in the
  `writeRoutes` table (`bridgeServer.ts:835`), and the per-tile button calls the
  live route (`fetch('/epic-reorder/make-top' + q, …)` with
  `controlAuthHeaders()`), not a stub.
- **Route hygiene:** `requireControlAuth` (BL-241 step-up), body size cap +
  shape guard, read fresh at request time, writes via
  `resolveEpicWritePaths` → `atomicWrite` → `runCommitIntegrity` — no raw git
  from the bridge. `value.id` reaching the commit message is safe: an id absent
  from the live set returns `null` → 404, so only real backlog ids are ever
  interpolated.
- **Declared invariants (BL-633/BL-654): all three encoded, and they BITE.**
  `makeTopPrioritySafety.property.test.js` checks against an independently
  written iterative traversal (not a call into the implementation's own logic)
  and asserts generator reachability (tied runs > 20%, cycles > 3, dangling > 3)
  rather than assuming it. Proven non-vacuous by deleting the
  `worseDeps.length > 0` refusal from the real implementation and recompiling:
  **2 of 4 properties failed** (invariant 1's and invariant 3's no-op half).
  Restored and re-verified green.
  - Invariant 1 reviewed as its own pass: refusal when a live dep ranks worse,
    bound placement immediately after the worst better-ranked dep, and the deps
    all sit at positions ≤ `positionOf(boundId)` so the walk never shifts one
    below the target. Holds.
  - Invariant 2: each single `'up'` step is BL-572-hardened for third-party
    order, and composition of order-preserving steps preserves order. Holds.
- **Suites:** 113/113 unit tests across the five touched test files; 20 files /
  69 tests of the property suite; 9/9 acceptance
  (`node specs/pipeline/cli.js specs/features/BL-672-epic-make-top-priority.feature`).
  `.feature.draft` correctly materialized with handlers wired in the same parcel
  (BL-441/BL-233).

## Noted, not blocking (for whoever picks up the atomicity hardening)

Invariant 3's "or writes nothing" is guaranteed against the **resolution**
failure only. `resolveEpicWritePaths` pre-resolves every path before any write
(that all-or-nothing pre-check is BL-572 architect bounce #3's own secondary
finding), but the apply loop still writes file-by-file: an IO fault partway
through — including a `backlog/paused/X.yaml` the coordinator promotes to
`active/` between resolve and read, which is a real concurrent operation in this
system — leaves some files rewritten, uncommitted, and matching neither order.
BL-672 copies BL-572's shipped apply block verbatim here, so this is inherited,
not introduced, and fixing it belongs to both routes as its own ticket rather
than to this bounce.

## Branch-state deviation from BL-490/BL-495 — read before the rework

The bounced content is **not** on `main` (`git merge-base --is-ancestor
0ada474942 main` is false), so BL-490/BL-495's on-`main` exception does **not**
apply and the revert is owed. It could not be done per-ticket:

```
$ git revert --no-commit --no-edit 2af1e046b
CONFLICT (content): Merge conflict in extension/src/bridge/bridgeServer.ts
CONFLICT (content): Merge conflict in extension/src/bridge/epicReorderUiHtml.ts
CONFLICT (modify/delete): extension/src/bridge/makeTopPrioritySafety.ts deleted in
  parent of 2af1e046b and modified in HEAD
CONFLICT (content): Merge conflict in specs/pipeline/steps/index.js
```

BL-673 modifies the file BL-672 creates, so **BL-672/BL-673/BL-674 are one
indivisible unit inside `0ada474942`**. I therefore reverted the whole make-top
group (`0ada47494`, `c54eeeaa2`, `98b501664`, `2af1e046b`) out of the architect
branch and kept BL-648's approved content (`d2327f832`) intact. **This handoff
points at the PRE-revert evidence commit, not the post-revert branch tip** — the
reverts live on the architect branch only, and merging the tip would delete the
very work this bounce asks to fix.

On the rework: `git revert --no-edit <the architect revert commit>` before
merging, then verify by file existence (`makeTopPrioritySafety.ts` and the three
test files present) rather than by a green suite.

## Reported to the coordinator — one commit, four tickets

`0ada474942` carries four tickets: BL-648 (**approved, already forwarded to the
hardener as `5a2b658f6c`**), BL-672 (**defective, this bounce**), and BL-673 +
BL-674 (**unreviewed**, their parcels still in the architect inbox pointing at
this same tip). The cleaner forwarded each ticket separately, which Article 2.6
requires — but because all four name the SAME commit, approving any one of them
drags the other three toward `main` under that approval. Concretely: the commit
I forwarded for BL-648 contains this BL-672 defect, so **QA must not land
`5a2b658f6c` until BL-672's rework has landed**. The BL-673/BL-674 parcels in my
inbox are now stale and will be sent back to ride the rework commit, each under
its own stable task name.

By architect.
