# BL-1620 — coder investigation, 2026-09-17 (no fix landed — escalating)

## Summary

Both named files' actual, measured dominant cost comes from exercising
REAL, unavoidably-slow behavior this ticket's own constraints forbid
touching (`No production code`) or weakening (`Keep every assertion`).
Neither of the two named remedies ("a materialized fixture tree instead
of the live repo" / "an in-process CLI main instead of a spawned node per
case") is what is actually costing time in either file — both remedies
are, in fact, **already applied** in both files. I have not committed a
fix; this is a documented finding for the specifier to adjudicate, not a
parcel.

## `bl968StepRegistryMaterializedTreeGuard.test.js`

Already uses a materialized fixture tree (`materializeCurrentPipeline()`,
BL-968) — it does **not** walk the live repo. Measured just now
(`npx vitest run test/bl968StepRegistryMaterializedTreeGuard.test.js --reporter=json`):

- Test 1 (invariant 1, one registry-load spawn): **15302 ms**
- Test 2 (D1 leak guard): 792 ms
- Test 3 (invariant 2, plants an offender then loads again + a require
  probe on failure = two more spawns): **24193 ms**

Test 1 ALONE already exceeds the 7000 ms per-file budget. The file's own
header (lines 38-43, dated 2026-08-20) already documents why: "the
green-path resolver run is ~10-27s under swarm load - almost entirely the
registry's own require pass (dominated by bl674EpicDrilldownUiSteps'
jsdom require, ~8-11s, which is LEGAL load-time work under invariant 1: a
require). **This file therefore exceeds the 7s per-file budget by
design**; the real BL-761 gate pays the same require pass on every
QA-bound send, and the guard must mirror it."

The single-spawn cost cannot be reduced without either (a) reducing what
the CURRENT real step registry actually requires at load time — a
production-code change to `bl674EpicDrilldownUiSteps.js` (or whichever
step file dominates today; not re-profiled line-by-line since the fix
would be out of scope regardless), explicitly forbidden by this ticket's
`No production code` constraint, or (b) no longer proving the registry
loads from a *materialized, complete, current* tree — which is invariant
1's entire point, so weakening it is excluded by "keep every assertion."

I did not find a third option. Consolidating tests 1 and 3 into one
spawn (sharing the "clean load" and "planted-offender load" inside one
child process) would roughly halve the aggregate file time but each
individual load is *already* over budget alone, so this would not bring
the file under 7000 ms — it would only reduce how far over it lands.

## `extension/test/telegramFrontDeskBotCli.test.js`

Already uses the in-process `main()` pattern (`runCli`, lines ~406-444) —
the CLI-dispatch tests do **not** spawn a node process per case;
`runCliSubprocess` (real spawn) is used in only 2 of 275 tests, for cases
that specifically need process-boundary behavior. So the "spawned node
per case" remedy this ticket names does not describe this file's actual
shape either — it was already fixed, apparently by an earlier, unticketed
pass (comments at `gitFixture()`/`copyCommitIntegrityScripts` explicitly
cite BL-1038/BL-1039, the same two "slice B" precedents this ticket's own
"How" section points at).

Measured (`npx vitest run test/telegramFrontDeskBotCli.test.js --reporter=json`):
file total **22899 ms** across 275 tests. The 10 slowest tests account
for **21751 ms — 95% of the file's total**:

```
2883ms BL-1203: a caller with no updateId (legacy call shape) is never deduped against itself or anything else
2844ms BL-1203: a legacy call interleaved between identity-keyed calls does not erase prior dedup history
2784ms BL-1203: two DIFFERENT updateIds with byte-identical text both queue - identity, never content, is the key
2766ms BL-1203: the pointer file is refreshed even for a short, inline-fitting answer (invariant 2)
2577ms BL-1518: swarm_handoff.bb refuses a draft that lies outside the project root ... delivers normally once cwd/env point at the draft's own root
1438ms BL-607: enqueueRoleAnswerNote falls back to a file pointer for a short multi-line answer ...
1416ms BL-1203: enqueueRoleAnswerNote with the same updateId twice, long-form pointer answer, still queues only one note
1393ms BL-1203: enqueueRoleAnswerNote with the same updateId twice queues only one note
1372ms BL-607: enqueueRoleAnswerNote falls back to a file pointer + writes the full answer alongside ...
1348ms BL-607: enqueueRoleAnswerNote returns false, never throws, when the target has no roles.tsv at all
```

Every one of these calls `enqueueRoleAnswerNote` (1-2 times per test) or
directly `execFileSync('bb', [swarm_handoff.bb, ...])` (BL-1518). Both
are the SAME production function
(`extension/src/tools/telegram-front-desk-bot.ts:1826`), which itself
shells out via `execFileAsync('bb', [cli, draftPath], ...)` on every call
— a real Babashka process start each time, independent of anything the
*test* file controls. The BL-1203 tests each call it twice (testing
dedup across two calls, by construction), so each pays two real `bb`
starts; that is why they cluster at 2600-2900 ms while the single-call
BL-607 tests cluster at 1300-1400 ms.

This is not a "spawned node per test case" problem (that pattern is
already fixed here); it is a real Babashka process-start cost, paid by
production code this ticket may not touch, exercised by tests whose
whole point is proving the REAL `swarm_handoff.bb` script's own
validation and routing behavior end-to-end (BL-1518's own test explicitly
proves a real refusal *and* a real delivery through the real script).
Mocking or stubbing the exec call to avoid the cost would either require
a production-code seam (out of scope) or would stop testing what these
tests exist to test (violates "keep every assertion").

## What I did not do

No commit landed. I did not touch either file, `backlog/suite-poles.tsv`,
or any production file — there is nothing to send that satisfies this
ticket's own stated goal ("both files under 7000 ms... no production
code... keep every assertion") without one of those three constraints
giving way, and choosing which one is not a coder-level call.

## Recommendation (not a decision - the specifier's to make)

- `bl968...`: mirror what this ticket itself already had to grant `bl968`
  implicitly via its own 2026-08-20 header comment - either a documented,
  accepted per-file budget exception (the file already states one; this
  may just need the register/gate side to recognize it rather than the
  test to change), or a separate ticket to lazy-load or slim the specific
  step file(s) dominating the require cost (production code, its own
  review).
- `telegramFrontDeskBotCli.test.js`: either accept its current total as
  the cost of real end-to-end coverage of a `bb`-shelling production
  function (same shape as bl968), or open a separate ticket to give
  `enqueueRoleAnswerNote` (and the bare `execFileSync('bb', ...)` call in
  the BL-1518 test) an injectable exec seam - explicitly a production
  change, its own review and its own ticket.
- Alternatively: pick two DIFFERENT files from `backlog/suite-poles.tsv`'s
  remaining seven for this pass, and let BL-1620 (or a successor) re-scope
  to these two once one of the above is decided.

By coder.
