# BL-927 architect pass (fixture-leak QA-bounce fix) — 2026-08-19

## Scope

Received from cleaner as `merge_and_process cleaner 4b78f28073`. Coder's own
commit ("By coder." trailer); cleaner forwarded unchanged. This fixes the
QA bounce recorded in
`backlog/evidence/BL-927-rotate-gate-resolves-departing-role-from-the-raw-marker-bounce-20260819.md`
(a fixture-dir leak in the acceptance step handler — 272 accumulated stale
`bl927-rotate-gate-*` dirs under `$TMPDIR`, distinct from the two prior
architecture bounces on this same ticket, which were about the production
rotate-gate logic, not test hygiene).

Files reviewed (`git show --stat 4b78f28073`):
- `specs/pipeline/steps/bl927RotateGateLiveIdentitySteps.js` (only file
  touched — 90 insertions, 50 deletions)

## Checks run (complete inventory, not first-failure-stop)

1. **Remediation matches the bounce's own pointer** — adds `cleanupFixture(ctx)`
   (idempotent `fs.rmSync(ctx.dir, {recursive:true, force:true})`), wraps
   both When steps' bodies in `try { ... } finally { cleanupFixture(ctx) }`,
   and additionally wraps the one Given step that can throw before either
   When step runs (`the active-role marker is (missing|blank)`, via
   `knownMarkerState`'s Scenario-Outline validation) in its own
   try/catch-cleanup-rethrow — exactly the shape the bounce's remediation
   pointer named (mirroring BL-929/BL-931's own precedent for this defect
   class).
2. **Every throw-capable step before a When step's own cleanup is now
   covered** — read the whole file (not just the diff hunks): the Background
   (`mkFixture()`) and the other three Given steps (`marker names`, `live
   identity is/cannot be read`, `role holds a real parcel`) build fixture
   content from fixed values (`cleaner`/`coder`/`documenter` from the
   Background's own `roles.tsv`, or Scenario Outline columns that are never
   passed through a throwing validator) — none of them call a function that
   can raise under any value the feature file actually supplies. The one
   Given step that DOES validate against `KNOWN_VALUES` and can throw
   (`knownMarkerState`) is the one now wrapped. No missed throw-site found.
3. **The nested `bl927-fakebin-*` directory (bounce's second finding)** — no
   longer an independent `mkdtempSync(os.tmpdir(), ...)`; moved to
   `path.join(ctx.dir, 'bin')` inside the already-cleaned fixture root, so
   the one `cleanupFixture` call releases it too. Confirmed no other
   independent `os.tmpdir()` mkdtemp/mkdir call remains in the file (grep for
   `os.tmpdir()` shows only the one `mkFixture()` call site left).
4. **Idempotent, safe to call from multiple finally blocks and a catch
   block** — `fs.rmSync(..., {force: true})` on an already-removed or
   never-created path is a no-op, not a throw; confirmed by re-running the
   suite (below) rather than by inspection alone.
5. **Dependency-rule gate (BL-259 hard gate)** — `dependency-gate.js` against
   the one changed file: N/A, same structural reason as every prior pass on
   non-`extension/src/` files (depcruise's scan root is `extension/`, no
   applicable rule for a `specs/pipeline/steps/` file).
6. **Co-change coupling (BL-255)** — `co-change-report.js` against the
   changed file: only 1 co-change each with its own feature file, the step
   registry (`index.js`), and the lib it drives (`handoff_lib.bb`) — all
   below the tool's own suspected-coupling threshold (3). Nothing new.
7. **No production code touched** — this is a test-infrastructure-only fix;
   the two-layer boundary, host-IO-ownership, webview-storage, secrets, and
   integrate-not-fork checks are not applicable (no `extension/` or
   `swarmforge/scripts/` production file in this diff).

## Verification (independent re-run, not just inspection)

- `node specs/pipeline/cli.js specs/features/BL-927-rotate-gate-resolves-departing-role-from-the-raw-marker.feature`
  → 7/7 scenarios PASS.
- Fixture-leak check, matching QA's own bounce methodology: counted
  `bl927-rotate-gate-*` and `bl927-fakebin-*` directories under `$TMPDIR`
  immediately before and after the run above (238 and 34 respectively,
  pre-existing from before this fix landed), then confirmed via
  `find ... -newermt "-2 minutes"` that the run created **zero** new
  directories of either name — the leak is gone, not merely reduced.

## Verdict

No architecture violation, no correctness defect found. The QA-bounced
fixture-leak defect is fixed and independently re-verified. Forwarding to
hardender.

By architect.
