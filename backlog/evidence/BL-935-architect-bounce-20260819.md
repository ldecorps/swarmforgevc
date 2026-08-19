# BL-935 architect bounce — 2026-08-19

## Reviewed commit

`e4b327e03` ("BL-935: cap the vitest fork pool under a live full-forge
pack on macOS", By coder), forwarded unchanged by cleaner (`d342d12772`
is a pure merge commit).

## Checks run (complete inventory, not first-failure-stop)

1. **required_wiring (2 anchors)**: both `BL-935` literals confirmed
   present in `vitest.config.mjs` and `vitest.properties.config.mjs`.
   **Independently confirmed with the actual gate**:
   `bb swarmforge/scripts/pre_qa_gate_cli.bb BL-935 e4b327e03` → `OK`.
2. **Every qa_e2e_procedure number independently reproduced, not
   trusted**: baseline (no pack) → 3; full-forge+macOS → 1, on BOTH
   `vitest.config.mjs` and `vitest.properties.config.mjs` (invariant 3);
   `SWARMFORGE_VITEST_MAX_FORKS=99` with no pack → still 3, not 99;
   malformed (`abc`), negative (`-5`), and zero (`0`) overrides under
   full-forge+macOS all fall through to the pack rule (→ 1), never
   floored or coerced; a truly UNSET `SWARMFORGE_PACK` (`env -u`, not
   merely empty-string) → 3, confirming a solo human is unaffected. All
   ran live against the real config files via subprocess, not the pure
   function alone.
3. **Unit suite**: 27/27 pass (after `tsc -p ./` — the merge landed
   source without recompiling `out/`, confirmed the stale-`out/` failure
   mode and recompiled before judging anything).
4. **Acceptance feature**: 9/9 pass, including scenario 02's real
   subprocess comparison of both config files.
5. **`chmod`/fixture discipline**: N/A — the step handler introduces no
   fixture directory at all (matches the ticket's own explicit direction:
   "It needs no fixture directory; do not introduce one"), confirmed by
   reading the file — only `execFileSync` subprocess calls, no
   `mkdtempSync`.
6. **Dependency-rule gate (BL-259 hard gate)**: PASSED, no forbidden
   edges (ran against all 6 changed JS/TS files).
7. **Co-change report (BL-255)**: SUSPECTED COUPLING hits exist between
   `vitest-worker-memory-budget.ts`/`vitest.config.mjs` and several
   unrelated tool/test files — read directly and confirmed this is
   PRE-EXISTING history from BL-422/BL-792 and other tickets that
   previously touched this same shared budget module and config file, not
   new coupling this parcel introduces (BL-935's own diff only adds one
   function and two call sites).
8. **Module boundaries**: not implicated — this is build/test tooling
   config (`extension/vitest*.config.mjs`, `extension/src/tools/`), not
   extension-host/webview runtime code; reading `process.env`/`os.platform()`
   directly in a vitest config file matches the pre-existing pattern
   (`os.totalmem()` was already read there before this ticket).
9. **Invariant 2** ("resolved fork count is at least 1 for every
   combination, including absent/malformed/zero/negative overrides"):
   holds — verified by direct reproduction (item 2 above) and confirmed
   the coder's own documented non-vacuity check for it is TRUE (see D1's
   own investigation below: breaking `resolveWorkerPoolSize`'s floor
   really does fail the "never below 1" property, exactly as claimed).
10. **Invariant 3** ("both vitest lanes resolve through the same code
    path"): correctly NOT encoded as a property test — the coder's own
    reasoning (a wiring/process claim, not a data property over generated
    inputs) is sound. Independently verified via the acceptance feature's
    real-subprocess comparison (item 4) and by reading both config files
    directly (identical import and call sites).

Items 1-10 above are clean. One item — invariant 1's own property
test — is not.

## D1 — property test P1 is structurally vacuous for invariant 1, and its
own documented non-vacuity claim is false

**Class**: `invariant-unencoded` — per the architect prompt's own standing
rule: "A missing or vacuous property test (one that stays green against a
deliberately broken implementation) is itself a send-back... you never
hand-verify a property whose own test does not exist or does not bite."

**Where**: `extension/test/vitestForkCeiling.property.test.js`, the first
test (`'property: the pack/platform/override ceiling never RAISES the
fork count above what raw RAM allows'`, lines 48-70) — the property named
to encode invariant 1's YAML text ("the memory-derived budget... stays an
absolute upper bound for every combination of pack, platform and
override").

**Reproduced, not assumed**: the property test file's own header comment
claims non-vacuity was checked by hand: "forcing resolveVitestForkCeiling
to always return Infinity (never any ceiling) fails P1 on its first
generated case where the pack rule would otherwise have lowered the
count." The commit message repeats the same claim ("forcing the ceiling
to Infinity fails the full-forge=1 property" — note even the two landed
claims disagree with each other about which test fails).

I performed the exact experiment: edited `resolveVitestForkCeiling` to
`return Infinity;` unconditionally (a maximally broken implementation —
zero constraint applied, ever), ran `npm run test:properties --
vitestForkCeiling`. Result: **P1 stayed green.** Only the third test
("full-forge on macOS with no override resolves to exactly 1") failed.
Restored from an untouched backup, confirmed `git diff` empty,
reconfirmed all 4 green again.

**Why P1 cannot fail, structurally, not just in this one trial**: P1
compares `resolveWorkerPoolSize(hostRamMB, ceiling)` against
`resolveWorkerPoolSize(hostRamMB, Number.MAX_SAFE_INTEGER)`. Given
`resolveWorkerPoolSize`'s own (pre-existing, BL-422/BL-792, unchanged by
this ticket) body — `Math.max(1, Math.min(ceiling, safeCount))` — it is a
mathematical identity that `Math.max(1, Math.min(X, safeCount)) <=
Math.max(1, Math.min(MAX_SAFE_INTEGER, safeCount))` for ANY finite real
number `X`, regardless of what `X` is: when `X <= safeCount`,
`min(X,safeCount)=X` and `max` is monotonic; when `X > safeCount`,
`min(X,safeCount)=safeCount`, making both sides equal. There is no
finite value `resolveVitestForkCeiling` could ever return — including a
completely wrong, unconstrained one — that P1 could detect. P1 tests a
property that is already guaranteed by `resolveWorkerPoolSize`'s own
pre-existing composition, not by anything this ticket's new function
does. It is not merely weaker than advertised; it cannot fail for any
input this function is capable of producing.

**What actually carries invariant 1's real weight**: the third property
test (`'full-forge on macOS with no override resolves to exactly 1, at
every possible host RAM size'`) DID catch the Infinity break, and is a
genuine, non-vacuous property — but only for ONE fixed
(pack, platform, override) combination, not "every combination" as
invariant 1's own declared text requires. Invariant 1's "for every
combination" claim is therefore verified by property test for exactly
one combination out of the input space, not the space itself.

**Confirmed the OTHER non-vacuity claim in the same file is accurate**,
so this is not a blanket rejection of the file's testing discipline: 
reverted `resolveWorkerPoolSize`'s floor (`Math.max(1, ...)` removed) and
confirmed the second property ("never below 1") does fail, exactly as
documented. Restored and reconfirmed green.

**Why this matters enough to bounce rather than note**: this session has
repeatedly relied on "non-vacuity checked by hand" claims, from this same
coder, as the signal that a property test provides real protection — my
own architect passes today cited and trusted several such claims without
independently re-deriving each one from first principles. A landed,
specific, checkable claim that is simply false is exactly the kind of
thing that erodes the reliability of that whole practice, independent of
whether the shipped FEATURE itself works (it does — every other check in
this inventory passed cleanly).

**Remediation** (direction, not mandate): either (a) reframe P1 to test
something `resolveVitestForkCeiling` actually controls — e.g., a
property holding `hostRamMB` fixed and comparing the resolved count under
`pack='full-forge', platform='darwin'` against the count under a
DIFFERENT pack/platform for the same override, asserting the full-forge
case is always `<=` the other (a genuine relative constraint the pack
rule is responsible for), or (b) accept that test 3 is the property that
actually carries invariant 1 and drop or repurpose P1, correcting its
docstring and this file's own non-vacuity comment to stop claiming
something the experiment above disproves. Either way, the false claim
in the file's own comment (lines 26-28) must be corrected — leaving it as
written misdescribes what was actually checked to the next reader.

## Everything else in this parcel is clean

Items 1-10 above. D1 is the only item in this inventory.

By architect.
