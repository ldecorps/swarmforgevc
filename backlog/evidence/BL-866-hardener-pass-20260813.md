# BL-866 — hardener pass — 2026-08-13

## Scope received

Merged architect's `4d02fa92f1` (git_handoff, merge_and_process) into hardener
on top of `4f3f900b9`. Files in scope per architect's own evidence:
`extension/src/bridge/companionManifest.ts` (new),
`extension/src/bridge/bridgeServer.ts` (wiring),
`extension/src/docs/docsTree.ts` (`readVisionDocs` widened to exported).

## Pre-flight

- No orphaned test/mutation processes from a prior run
  (`pgrep -fl 'node --test|stryker'` clean before starting).
- `uptime` at pass start: load avg 27.91 / 44.48 / 57.49 on 4 cores —
  well over the 2x-cores busy threshold for the whole pass.

## BL-149 cooldown gate

`bb swarmforge/scripts/mutation_cooldown_gate.bb` (cores forced via
`SWARMFORGE_MUTATION_GATE_FORCE_CORES=4`, no `nproc` on macOS) against each
changed production file:

- `extension/src/bridge/bridgeServer.ts` → **skip-cooldown** (file age 0.36
  days, inside the 3-day window — still actively churning).
- `extension/src/bridge/companionManifest.ts` → **skip-busy** (host busy).
- `extension/src/docs/docsTree.ts` → **skip-busy** (host busy).

No file reached `run` this pass. **No Stryker language-mutation run was
performed** — every changed production file was gated off, either by
cooldown or by host business, per BL-149/office-hours-mutation-bypass
policy. Deferred to a quiet pass.

## Test verification (targeted, not full suite — load-conscious)

- `npm run compile`: clean.
- `npx vitest run companionManifest.test.js bridgeServer.test.js`:
  **104/104** before my CRAP fix, **104/104** after (re-ran post-edit).
- `npx vitest run --config vitest.properties.config.mjs companionManifest`:
  **2/2** (both declared-invariant property tests, 60 runs each).
- `node specs/pipeline/cli.js specs/features/BL-866-companion-manifest-package-catalog.feature`:
  **10/10** scenarios (all 7 + the 3-row Scenario Outline), functional pass.

## CRAP fix (regression found and corrected)

`node scripts/crapReport.js src/bridge/companionManifest.ts
src/bridge/bridgeServer.ts src/docs/docsTree.ts` against a scoped coverage
run (companionManifest + bridgeServer + docsTree test files):

- `companionManifest.ts`: every function ≤5 CRAP, all 100% covered. Clean.
- `bridgeServer.ts`'s request-listener anonymous function (the giant
  per-request dispatcher `http.createServer((req, res) => { ... })`) had
  the coder's two new `if` blocks (companion-manifest + companion-package,
  ~6 added branches) inlined directly into it, pushing that function from
  its pre-existing ~complexity 22 to complexity 28 (CRAP 39.77 in this
  scoped run — the dispatcher was ALREADY over the CRAP<=6 threshold before
  this ticket touched it, from ~20 unrelated pre-existing routes: telegram
  mirroring, pausedPager, epicReorder, etc. — none of that is this ticket's
  to fix).
- Extracted the two new blocks into a standalone `tryServeCompanionRoutes(res,
  url, targetPath): boolean` function, mirroring the file's own existing
  `tryServeSideloadApk(req, res, targetPath, url): boolean` pattern (same
  file, ~380 lines above) — a behavior-preserving split, not new product
  behavior. The dispatcher now just calls `if (tryServeCompanionRoutes(res,
  url, targetPath)) return;`.
- Re-ran CRAP: `tryServeCompanionRoutes` reports complexity=6,
  coverage=100%, **CRAP=6.00** — at threshold, own logic fully covered.
  The parent dispatcher's own pre-existing CRAP debt (unrelated routes) is
  untouched — not this ticket's scope to fix, and this extraction reduces
  rather than adds to its raw complexity going forward.
- Re-ran the full targeted test suite after the edit: still 104/104 unit +
  2/2 property, all green — behavior-preserving confirmed.

## DRY

`npx jscpd --config .jscpd.json src`: 36 clones total across the whole
`src/` tree, all pre-existing (telegramCursorBridge*/swarmStopper/tools —
unrelated files). Neither `companionManifest.ts` nor the
`tryServeCompanionRoutes` extraction appears in any clone. No DRY
regression.

## BL-113 Gherkin acceptance-mutation (soft) — attempted, deferred

The feature has one `Scenario Outline` (catalog-requires-authorization-08,
3 example rows) so BL-113 applies. Ran
`specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-866-companion-manifest-package-catalog.feature ""
specs/pipeline/steps/bl866CompanionManifestPackageCatalogSteps.js soft` in
the background.

After 8+ minutes with `uptime` load avg sustained at 37–50 on 4 cores
(~10x) for the entire run and **zero mutants completed** (`total=9
completed=0 running=0 killed=0 survived=0 errors=0` unchanged the whole
time — each mutant boots a real HTTP bridge server + a `node --test`
subprocess, exactly the shape that stalls under this kind of load), killed
it cleanly by process group
(`kill -- -<pgid>`; confirmed the pid and its one child both gone) rather
than let it hang for hours per the documented Stryker-under-load pattern —
the same host-contention failure mode, not a defect in the ticket's code.

Verified clean after kill: `pgrep -fl 'node --test|stryker'` empty,
`pgrep -afl tmux` shows only the swarm's own `swarmforge-coder` and
`operator` sessions (no leaked fixture tmux server — this run never got far
enough to spin one up).

**Deferred to a quiet pass**, same posture as the office-hours Stryker
bypass: this parcel must not stall the pipeline waiting for host quiet
hours. Functional acceptance (10/10, non-mutation) already passed above,
so no missing step-handler risk (BL-203/BL-221) is being carried forward
unverified — only the mutation *strength* check on the Outline's 3 example
rows is deferred.

## Verdict

Hardened: CRAP regression found and fixed (extraction, behavior-preserving,
104/104 + 2/2 tests still green). Stryker and Gherkin-mutation both
legitimately gated/deferred by sustained extreme host load, not skipped
arbitrarily — every gate's reasoning recorded above for whoever runs the
deferred passes. Forwarding to documenter.

By hardener.
