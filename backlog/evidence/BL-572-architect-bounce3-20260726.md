# BL-572 — architect bounce #3 (round 3), 2026-07-26

**Parcel reviewed:** cleaner `711263bfae` (merged into `swarmforge-architect` as
`330dc7c68` for review, reverted out again on bounce per BL-490/BL-495).
**Blamed role:** coder. **Failure class:** `behavior`.
**Verdict:** architecture PASS. One declared invariant is violated at the UI
edge — send back.

---

## Everything that PASSED — do not disturb it in the rework

The structure is right and the two earlier defects are genuinely fixed. This
bounce is one narrow behavior gap, not a rebuild.

| Check | Result |
|---|---|
| Dependency-rule gate (BL-259, hard gate) on all 6 changed source files | **PASSED**, no forbidden edges |
| Two-layer / host-owns-IO / no-webview-storage / secrets | compliant — pure decision core (`epicReorderSafety.ts`) beside the IO edge, exactly the `expediteSafety.ts` precedent the ticket named |
| Surface rule (live console, not the static PWA) | correct — `/epic-reorder` on the token-authed bridge |
| Acceptance `BL-572-...feature` | **7/7 pass**, including new scenario 07 |
| Full unit suite | **6096 tests / 357 files green** |
| Consumer sweep for the extracted `commitIntegrityRunner` | both consumers green (`telegramFrontDeskBotCli/Core`, 668 tests) |
| Bounce #1 defect (move shifts >1 position) | **fixed** — positional machinery holds under property test |
| Bounce #2 spec defect (tie runs unsatisfiable) | **fixed** by the amendment; no move is refused except at a true list boundary |
| Co-change report | flagged pairs are all same-parcel rework churn, no durable coupling |

### Declared invariants — property tests exist and BITE (BL-633/BL-654)

`extension/test/epicReorderSafety.property.test.js` encodes all three declared
invariants, plus a reachability-floor test that pins the generator to the tied-run
state this ticket exists for. I broke the implementation three ways and confirmed
each property fails rather than passing vacuously:

| Deliberate break | Property that caught it |
|---|---|
| `slotFloor` -> `return 0` (ignore the epic above) | invariant 1 FAILED ✔ |
| boundary result drops `reason` | invariant 3 FAILED ✔ |
| cascade bumps `prevValue - 1` | invariants 1, 2, 3 FAILED ✔ |

Restored and re-verified green (4/4). Invariants 1 and 2 hold; **no
`invariant-unencoded` finding.** Per the architect's property-testing pass, no
additional undeclared property is needed on the touched pure module — the three
declared ones already cover its round-trip/ordering/floor behavior.

---

## BLOCKING — invariant 3 is violated at the UI edge

> **Declared invariant 3:** "Every move tap yields an observable outcome: the
> displayed order changes, or the console states the reason it did not."

The property test proves this for the pure module. It is **not** true of the
screen, which is the half of the invariant the human actually experiences.

`extension/src/bridge/epicReorderUiHtml.ts`, in `move()`:

```js
}).then(function (r) {
  loading = false;
  if (!r.ok) {
    setStatus('Move failed (HTTP ' + r.status + ')');
    return r.json().catch(function () { return {}; });   // <-- parsed, then discarded
  }
```

The failure payload is fetched, parsed, and thrown away. The human is told an
HTTP status code; the server's `reason` — written specifically to be shown —
never reaches the screen. `'Move failed (HTTP 500)'` is not a reason.

Compounding it: the branch that DOES render a failure reason
(`if (!payload || !payload.success) setMoveStatus(payload.reason ...)`) is
**unreachable**. It only fires on a 2xx carrying `success:false`, and
`handleEpicReorderMoveRoute` never returns that shape — every failure it emits is
non-2xx (404/500), so every failure takes the branch that discards the reason.
The reason-rendering code and the reason-producing code never meet.

### Behavioral probe — what the screen actually shows

Loaded the real `getEpicReorderUiHtml()` script into a stubbed DOM, clicked
Move up, and varied only the server response:

| Server response | Reason the server sent | What the human sees | Reason reaches human? |
|---|---|---|---|
| 200 `{success:true, changed:false, reason}` (boundary) | "Already first in the list…" | "Already first in the list…" | **YES** ✔ |
| 200 `{success:true, changed:true}` | — | list refreshes | n/a ✔ |
| 404 `{success:false, reason}` | "epic not found in paused" | "Move failed (HTTP 404)" | **NO** |
| 500 `{success:false, changed:true, reason}` | "write succeeded but commit failed" | "Move failed (HTTP 500)" | **NO** |
| 500 `{success:false, reason}` | "epic file missing during write" | "Move failed (HTTP 500)" | **NO** |
| 401 (control token expired) | — | "Move failed (HTTP 401)" | n/a (none sent) |

So the boundary no-op — the one path bounce #2 named explicitly — was fixed, and
every other stated reason is still swallowed. This is the same defect as bounce
#2's second finding, remediated on one path only.

### Why this one matters rather than being cosmetic

The worst swallowed case is `"write succeeded but commit failed"`. That is
**BL-490's exact live failure mode**, the one scenario 06 exists to prevent: the
YAML edits are already on disk via `atomicWrite`, the commit did not happen, and
the backlog is now dirty and uncommitted. The human is shown `HTTP 500` and the
list is not refreshed, so the screen still displays the OLD priorities while disk
holds the new ones. Nothing on screen suggests the backlog needs attention. The
string that says exactly what went wrong was received and dropped.

This project already treats that state as something to say out loud —
`blTopicStore` logs "the write succeeded locally but is NOT yet durable (git
commit failed)". The reorder screen should not be quieter than the log.

The `404` case is reachable in ordinary use, not just in theory: the list is
fetched once at load and only re-fetched after a successful move, so it is
routinely stale. If the coordinator promotes an epic out of `paused/` between
load and tap, the human gets `HTTP 404` and no explanation.

### Remediation (one property, one site — fix the class, not the instance)

In `move()`, make the non-2xx branch state the reason:

```js
if (!r.ok) {
  return r.json().catch(function () { return {}; }).then(function (payload) {
    setMoveStatus((payload && payload.reason) ? String(payload.reason) : ('Move failed (HTTP ' + r.status + ')'), true);
    setStatus('Move failed');
    if (payload && payload.changed) { refresh(); }   // disk changed: stop showing stale values
  });
}
```

The `changed:true` refresh matters: on the commit-failed path the order on disk
really did change, and the screen must stop showing the pre-move list.

Then either delete the now-dead 2xx-`success:false` branch or keep it as
defensive — but do not leave the only reason-rendering path unreachable.

Please also add the coverage that would have caught this: the "screen displays
that reason" half of the ticket's constraint is asserted **nowhere**. Scenario
03's step handler checks only the response body
(`specs/pipeline/steps/bl572EpicReorderConsoleSteps.js:202`), and
`epicReorderUiHtml.ts` has no test of any kind. A single test over the emitted
script's failure branch is enough.

---

## Secondary — fix in the same round (small, same file as the route)

`handleEpicReorderMoveRoute` resolves each write's path *inside* the write loop
and returns 500 mid-way if one is missing:

```js
for (const write of result.writes) {
  const filePath = findBacklogFilePath(targetPath, write.id);
  if (!filePath) { respondJson(res, 500, ...); return; }   // earlier writes already applied
  ...
  atomicWrite(filePath, ...);
}
```

`atomicWrite` gives per-file atomicity, but the tie-run cascade now writes three
or more files as one logical change. A failure part-way leaves a **partially
rewritten, uncommitted** backlog matching neither the old nor the new order —
which can leave invariant 1 violated on disk (the mover displaced by more or less
than one position). Resolve every path up front, then write, so the failure lands
before anything is touched:

```js
const targets = result.writes.map((w) => ({ w, filePath: findBacklogFilePath(targetPath, w.id) }));
if (targets.some((t) => !t.filePath)) { respondJson(res, 500, {...}); return; }
```

Note while you are there: `findBacklogFilePath` searches `active/` **before**
`paused/`, while `readPausedEpics` reads `paused/` only. Today ids are unique
across folders so this is benign, but read and write deriving their file from
different rules is worth a comment at minimum.

---

## Non-blocking notes (no rework required, listed for completeness)

1. **Stale header chip on the boundary no-op.** The probe shows the header still
   reads `"Moving BL-200…"` after the reason line has been set — `setStatus` is
   never cleared on that path. One line, cosmetic.
2. **`Number.MAX_SAFE_INTEGER` sort sentinel can still reach disk** (third round
   carrying this note; the specifier marked it optional and I am not blocking on
   it). `readPausedEpics` substitutes `MAX_SAFE_INTEGER` for a missing
   `priority:`; for `[BL-100(0), BL-200(none)]`, moving `BL-200` up writes
   `priority: 9007199254740991` into BL-100's YAML. Reachable only through a
   schema-invalid ticket (`priority` is required per `backlog-schema.md`). Cheap
   to close while `readPausedEpics` is open anyway.

---

## Reproduction

Worktree-local, not committed (`tmp/probe-ui-outcome.js`): extracts the inline
script from the compiled `getEpicReorderUiHtml()`, evaluates it against a stubbed
DOM/`fetch`, clicks the second row's "Move up", and reports `#status` /
`#move-status` text plus whether the list refreshed, for each response shape the
route can return. Table above is that script's output verbatim.

Non-vacuity of the property tests was shown by patching the compiled
`out/bridge/epicReorderSafety.js` (three separate one-line breaks), running
`vitest --config vitest.properties.config.mjs`, and restoring after each.

By architect.
