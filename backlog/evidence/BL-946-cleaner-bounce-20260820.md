# BL-946 — cleaner review pass: BOUNCE to coder (complete inventory)

**Received**: `git_handoff` from coder, `dae4d10069`, task
`BL-946-epic-icon-pool-draws-from-whole-stock-set`.
**Verdict**: BOUNCE to **coder** (the only blamed role). **2 defects.**
Complete inventory — every check below was run; none was blocked, and none
was skipped after the first failure.

---

## D1 — `resolveEpicIcon` returns a FUNCTION for prototype-named epic ids
**Class**: `behavior` · **Blamed**: coder · Violates the ticket's **declared
invariant 3** ("resolveEpicIcon stays pure and total … still returns a usable
icon", whose stated reason is "its callers include a live tick that must not
be able to crash on an unusual epic id").

`extension/src/concierge/epicIcon.ts`:

```ts
const known = KNOWN_EPIC_ICON[epicId];
if (known !== undefined) { return known; }
```

`KNOWN_EPIC_ICON` is a plain object literal, so a bare `[epicId]` lookup
reaches `Object.prototype`. Any epic id named after a prototype member
resolves to the inherited **function**, which is `!== undefined`, so the
guard returns it as the icon. Measured on the merged tree:

| epicId | `typeof resolveEpicIcon(id, [])` | `isKnownEpic(id)` |
|---|---|---|
| `valueOf` | **function** | false |
| `toString` | **function** | false |
| `constructor` | **function** | false |
| `hasOwnProperty` | **function** | false |
| `normal-epic` | string | false |

Reproduced at the coder's own commit `dae4d10069` in a scratch worktree, so
this is not an artifact of the merge or of any cleaner edit.

Note the disagreement inside one file: **`isKnownEpic` already does this
correctly** — `Object.prototype.hasOwnProperty.call(KNOWN_EPIC_ICON, epicId)`
— and returns `false` for exactly the ids `resolveEpicIcon` mishandles. Two
functions over one table answer differently about what is "known".

Live blast radius — both callers pass the result to the Telegram API:
`conciergeTick.ts:802` (`resolveAllEpicIcons`, the live tick invariant 3
names) and `tools/backfill-epic-topic-icons.ts:68`.

**Remediation (fix the class, not the instance)**: read `KNOWN_EPIC_ICON`
through the same own-property guard `isKnownEpic` already uses — e.g. have
`resolveEpicIcon` branch on `isKnownEpic(epicId)`, so the two can never
disagree again — or give the table a `null` prototype.

---

## D2 — the invariant-3 gate catches D1 only on a lucky seed
**Class**: `test-coverage` · **Blamed**: coder

`extension/test/bl946EpicIconPoolInvariants.property.test.js`'s invariant-3
property drives `epicIdArb` over 300 draws. It **did** catch D1 here —
`Counterexample: ["valueOf",[]]`, seed `244626042` — but a re-run of the same
file on a different seed **passed**, and so did a full 118-file property-lane
run. fast-check seeds randomly per run, so whether this gate fires is chance.
That is how D1 reached cleaner with the handoff reporting "property file
3/3".

**Remediation**: make the prototype-key case deterministic rather than
generative-lucky — e.g. `fc.constantFrom('valueOf', 'toString',
'constructor', 'hasOwnProperty', '__proto__')` mixed into `epicIdArb`, or an
exhaustive non-property assertion beside it. A gate for a declared invariant
should not depend on the seed.

---

## Checks run — everything else PASSED

| Check | Result |
|---|---|
| Pool derivation measured against the live snapshot | **PASS** — 98 icons / 112 snapshot; 0 members absent from the set, 0 reserved collisions, 0 duplicates, 0 duplicates in the snapshot itself |
| Invariants 1 and 2 (exhaustive over the pool) | PASS |
| `epicIcon.test.js` + `conciergeTick.test.js` | PASS (127 tests) |
| `npm test` (unit) | **444 files / 7913 tests pass.** Two files failed only under parallel load (`dependencyGateCliStorageGlobals`, `startBridgeHeadlessCli`) and both pass in isolation — not defects |
| `test:properties` (full lane) | 118 files / 368 tests pass. 4 unhandled errors, **all** the allowlisted `[vitest-worker]: Timeout calling "onTaskUpdate"` artifact — lane green per the engineering rule |
| Merge integrity audit | see the de-duplication note below |
| Architecture: `epicIcon.ts` purity, no I/O, live validation still `syncTopicIcon`'s job | PASS |

The pool design itself is **right** and is not what is bouncing: deriving the
pool from a committed snapshot minus the reserved tables is exactly the
ticket's preferred shape, and it makes invariant 1 true by construction. D1
is in the resolver, untouched by this ticket's own description ("resolveEpicIcon,
pins, isKnownEpic, and the graceful-reuse tail are untouched") — the defect
was already there and this ticket's own new gate is what exposed it.

**Degraded tooling — recorded, not implied away.** BL-946 is TypeScript, so
mutation/CRAP/DRY tooling **is** wired here, unlike the Babashka parcels —
but I did not run Stryker, CRAP, or jscpd on this pass, because the parcel is
bouncing on D1 and those gates belong to the hardener downstream of a
resolver whose contract is about to change. Recorded as NOT RUN, not as
passing.

---

## Merge integrity — one silent duplicate caught

The parcel merged with three conflicts, two of which were the **same fix
arrived at independently** on both sides (this branch's BL-967 cleaner pass
and the coder's BL-967 rider `4101e4bfb`): `REQUIRED_SCRIPT_FILES` and the
guard runner's `try`/`finally`. Beyond those, git auto-merged
`specs/pipeline/steps/lib/operatorRuntimeBbFixtureFiles.js` **with no
conflict** while landing `'daemon_cycle_guard_lib.bb'` **twice** — both sides
added the same entry at different positions. De-duplicated in `dcc94edbc`;
the list is back to 29 unique entries.

## Bounce disposition

Bounced to **coder**; D1 and D2 are both coder's, so the inventory does not
travel through another stage.

**The revert is SCOPED, not `-m 1`.** The merge `dcc94edbc` is entangled: it
also carries `4101e4bfb`, a **BL-967 rider** (that ticket is already with the
architect) declaring `daemon_cycle_guard_lib.bb` in the two consumer fixture
lists and moving the guard runner's `delete-tree` into a `finally`.
`git revert -m 1` would have reverted that other ticket's work too, so
BL-946's own paths were reverted individually and the BL-967 rider content
was verified still present by CONTENT afterwards, not by ancestry.

Cleaner work prepared on this parcel is parked, not lost, and re-applies when
BL-946 returns (saved as `tmp/cleaner-bl946-cleanups.patch`, not committed):
(a) `epicIcon.ts`'s "Pure: no I/O…" comment block had been orphaned from
`resolveEpicIcon` by BL-457's later insertion and now sits above
`isKnownEpic` — the same comment-split shape the architect bounced BL-967's
D3 for; (b) `BADGE_SIZE_READ_ALIKES` names each glyph's reserved twin only in
a trailing comment, so a read-alike whose twin nothing reserves (a stale
exclusion shrinking the pool) cannot be caught — making the twin data lets
the invariant-2 test assert it.
