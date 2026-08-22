# BL-1038 — coder, 2026-08-22: architect SEND BACK #2 (D1) cleared

## The bounce was right, and my previous evidence overstated its cover

Bounce #2's D1 is the residual my own port evidence disclosed but argued was
already ruled on. The architect checked and could not find that second ruling —
correct. The `notes:` AMENDMENT FOLLOW-UP discusses the SIX SHARED FILES only,
never the four headline readers. There was one ruling, not two, and it did not
cover this. The gap is a real defect and is fixed here rather than argued again.

Bounce #1 (`125be7981`, 11:31) is also not an ancestor of the ported lineage —
the port came off the `origin/cutover/wsl-2026-08-22-*` snapshot, which diverged
at `82180f665` before that bounce landed, so its instruction never reached this
line. That is the cutover stranding, and it cost a full rebuild cycle.

## D1 — the guard could not see an indirect read

The four files never write a growth operation in their own source. They bind the
live root and hand it to a production module, which does the reading:

    const REAL_PROJECT_ROOT = path.join(__dirname, '..', '..');
    const diagrams = await runCli(REAL_PROJECT_ROOT);   // -> main() from ../out/

Every pattern in the guard required the growth operation to be written inline in
the test file, so `findLiveRepoDerivations` returned `[]` and the "real tree is
clean" assertion passed vacuously against the majority of the ticket's measured
cost.

### The boundary moves, deliberately

The guard's own header had rejected this boundary: "code given a root may read
one file or a thousand, and no static pattern separates them." That is still
true — which is exactly why it cannot be settled by a cleverer pattern. Handing
the LIVE root to production code IS the derivation, because the test stops
controlling what is read; whether a given escape is acceptable is settled by a
RECORDED EXEMPTION, not by the scanner guessing.

Detection is text-only — what makes a callee "production" is that the file
imports it from `../out/` or `../src/`, which the source states outright:

1. production import names, destructured and default;
2. **local forwarders**, closed to a fixpoint — a local function whose body calls
   a production name or spawns something under `out/`. `runCli` /
   `runCliSubprocess` are exactly this, and matching only the direct call is why
   two of the four stayed invisible even after the first attempt;
3. the live root as ANY argument of such a call — a bound
   `path.join(__dirname,'..','..')` variable, or that expression written inline,
   which is how `briefingDigestLineCli` reaches the repo with no binding at all.

Both function-body shapes are parsed, multi-line and one-liner; matching only
the first was itself a step on the way here.

## What the widened guard finds: 6 files, all reached, all justified in place

All four the architect named, plus two the same rule reaches honestly:

| file | callee | disposition |
|---|---|---|
| renderBriefingDiagramsCli | `runCli` | EXEMPT — renders the REAL maintained `docs/diagrams/*.mmd`; pinning copies leaves the guard green while a real diagram silently stops rendering. Cost is mermaid+resvg on two named files, not repo size. The ticket's own `approval_context` names this as the legitimate case. |
| renderBriefingBurndownCli | `renderBriefingBurndown` | EXEMPT — the two tests are titled "smoke test against the real repo" and cover the no-snapshot FALLBACK; the derivation logic is covered by the two fixture-snapshot tests beside them, which stay fast. Pinning both leaves the fallback untested. |
| briefingDigestLineCli | `runCli` | EXEMPT — proves the thin `main()` wrapper is genuinely wired (the CLI thin-wrapper rule this file's own header cites), which a fixture run cannot check. The digest logic is fixture-covered above. |
| emitLifecycleSnapshotCli | `lifecycleSnapshotPath` | EXEMPT — only RESOLVES a path under the root; the test reads and restores the file. No walk, so no growth. A pinned root would resolve to a fixture path and prove nothing about the real one. |
| chaseTrendLineCli | `runCli` | EXEMPT — one wiring check that the compiled CLI prints its line; trend computation is fixture-covered above. |
| pricingTable | `checkPricingCoverage` | EXEMPT — the live read IS the assertion: it collects the claude-* models the repo's own conf/packs reference and asserts the table covers each. A pinned copy would freeze the model list and let a newly-referenced unpriced model pass. |

Six exemptions is a number worth defending rather than glossing: every one of
these tests names itself a real-repo smoke test in its own title, each has
fixture-driven coverage of the same logic sitting beside it, and the ticket's
`approval_context` ruled precisely this case exemptable — "converting them
wholesale would delete real signal. So an exemption exists — but it must record
why". Each reason above says which live artifact is read and what pinning would
destroy. None is a restatement of the rule.

## The clean scan is now provably non-vacuous

The architect's standing requirement — "must stop passing vacuously with respect
to these four files" — is made executable rather than claimed. A new test strips
each of the four files' exemption marker and asserts the guard then NAMES it:

    BL-1038 D1: the four headline files are genuinely REACHED
                - remove the exemption and each is a violation

Green previously meant "the guard cannot see them", which is indistinguishable
from "they are fine". If a later change blinds the scan again, this goes red
instead of the tree quietly reporting `[]`.

## Verification

- `liveRepoDerivationGuard.test.js` — **19/19** (was 11), including 7 new D1
  detection tests written RED first: direct import, local wrapper, inline root,
  spawned CLI, and three negatives — a FIXTURE root handed to production, a live
  root used only to build a path (the O(1) case, `recordQaBounceCli`'s shape),
  and a non-production local helper.
- Real-tree scan: **6 reached, 0 unjustified.**
- Acceptance `BL-1038-...feature` — **8/8**.
- The six exempted files' own suites — **54/54**.
- `bl1038PinnedFixture.property.test.js` + `bl1039SharedRepoFixture.property.test.js` — 4/4.
- Unit lane: **466 of 467 files, 8267 of 8268 tests.** All 467 within BL-378's
  7s per-file budget. `test_count` 603, unchanged — nothing deleted or skipped
  (invariant 3).

## Not fixed here, and why

**The cleaner's dedup `dc0514a925`** (eight `copyScriptClosure` call sites into
one `copyLiveScriptClosureInto` helper) is NOT in this parcel. The architect
reverted BL-1038 out of their branch when they bounced, so it did not arrive
with the payload merge, and re-applying another role's refactor as coder work
would misattribute it. The cleaner is the next stage and owns that change; it
re-applies cleanly on top of this.

**`tempDirTrapGuard.test.js`** stays red on BL-1025's
`bl1025_expedite_approval_property_runner.bb` — pre-existing, an ancestor of
`main` and `origin/main`, red on `main` itself.

**Stale scratch checkouts under `./tmp/`** (`bl508-clean`, `bl520-clean-head-*`,
`bl538-*`, July `bl340-*`/`BL-466/482/485-*`) still break
`tempDirTrapGuard.property.test.js`'s repo-wide "defined in exactly one file"
scan by presenting 7 copies of the guard module. Not created by me, so surfaced
rather than swept; noted to the coordinator.
