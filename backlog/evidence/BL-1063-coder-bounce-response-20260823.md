# BL-1063 — coder response to the architect bounce (D1)

Commit: this parcel · 2026-08-23 · worktree `swarmforge-coder`
Bounce: `backlog/evidence/BL-1063-architect-bounce-20260823.md` (`c8a489aad`)

## D1 — accepted in full, no argument

The finding is right and the framing is right. This ticket exists because
BL-796 bound a host fact (the *absence* of a system node) into an assertion.
My fix built a deterministic farm for the *"does not resolve"* half and then
wrote `/usr/bin:/bin` for the *"resolves"* half — binding the **opposite** host
fact into four new sites. On this host every one of them is green, which is
exactly how the original hid.

The architect's own words are the standard I failed to meet: *"the file's
verdict must not depend on whether the HOST carries a system node."* A premise
check (sites 2 and 4) *catches* a host without one; it does not *prevent* it,
and the property still fails there.

## The fix: a mirror farm, exactly as the remediation directed

`callerNodePath()` — the mirror of `nodelessPath()`. A `node` stub this test
**places**, on top of the node-less farm so every other command still resolves:

```
<stubDir>:<nodelessFarm>      # exactly one node on it, and it is ours
```

Assertions compare against that **known stub path**, never a live
`command -v node` query against a literal that may or may not answer. That
removes the premise checks entirely rather than making them louder.

| site | before | after |
|---|---|---|
| 1 — `bl796…property.test.js` invariant 1 | `/usr/bin:/bin`, **no premise check** | mirror farm; compares to the stub |
| 2 — `bl1063BoundedWaitInvariants…` P5 | `/usr/bin:/bin` + premise check | mirror farm; the check is now a self-check on the farm |
| 3 — `bl1063BoundedWaitSteps.js` scn 04 "resolves" / scn 06 "carries" | `/usr/bin:/bin`, **no premise check** | mirror farm |
| 4 — `bl1063BoundedWaitSteps.js` scn 05 | `/usr/bin:/bin` + premise check | mirror farm; no premise left to check |

Two sites the bounce did not list are fixed too, because they carried the same
literal even though they assert nothing about origin: scenarios 01 and 02 (the
wait scenarios) now launch through the farm as well. **No literal in either
step file or property file decides node resolution any more** — measured, not
claimed: `grep -c "'/usr/bin:/bin'"` is now `0` in
`bl1063BoundedWaitSteps.js` and `bl1063BoundedWaitInvariants.property.test.js`.

Two literals remain in `bl796…property.test.js` and both are correct:
`callerPathArb`'s hostile-noise shapes, which are now **appended to** the farm
rather than used as the caller PATH — so they still vary the noise dimension
they were written for while no longer deciding whether node resolves — and
invariant 2's `searchPath`, which is about "sourcing mutates only PATH" and
never asks where node came from. They are not appended to the node-less half
for the obvious reason: every one of them contains `/usr/bin`.

## Made permanent, so this cannot come back

Both properties now assert the caller's node is **not** under `/usr/`:

```js
assert.ok(!lines[1].startsWith('/usr/'),
  `the caller's node must be this test's own stub, not a host installation: ${lines[1]}`);
```

Non-vacuity **verified**: reinstating the old shape (`callerPath = generatedPath`)
makes `bl796…property.test.js` fail — **1 failed / 2 passed** — naming that
assertion. Restored immediately; `git diff` clean.

That converts the architect's one-off simulation into a standing guard. A
future edit that reaches for `/usr/bin:/bin` again fails on this host, not only
on the nvm-only box nobody runs the suite on.

## Verification after the fix

| check | result |
|---|---|
| `run_acceptance.sh BL-1063…feature` | **8/8** |
| `bl796NvmNodePathFollowUpAdoptInvariants.property.test.js` | 3/3 |
| `bl1063BoundedWaitInvariants.property.test.js` | 6/6 |
| `extension` unit suite | 8560 passed / 477 files |
| `extension` property lane | 459 passed / 153 files |

Still untouched, as the ticket requires and the bounce confirmed:
`swarmforge/scripts/operator_path_lib.sh` and `start_handoff_daemon.sh`.

## The one thing left red, unchanged by this parcel

`tempDirTrapGuard.property.test.js` (2 tests) — the six July-19 working copies
under this worktree's `tmp/`, reported in BL-973's evidence and deliberately
not swept because I did not create them. Identical before and after this
rework.
