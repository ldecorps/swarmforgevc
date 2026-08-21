# BL-984 — architect review: clean sweep, PASS to hardener

**Parcel:** coder (fixture zombie-pid fix + BL-971 provenance answer, see
`backlog/evidence/BL-984-coder-findings-20260821.md`) + cleaner `91b0a6c579`,
merged into architect at `970fc2fc9`.

**Verdict:** PASS to hardener.

## Review completed (Article 4.4 — full inventory before any verdict)

- **Merge/ancestry sanity:** `git merge-base --is-ancestor 91b0a6c579 HEAD`
  confirmed after merge. Diffed the merge commit against BOTH parents
  (`4914eb7eb` prior architect tip, `91b0a6c579` cleaner tip): both diffs are
  strictly additive (new files / new lines only) — no architect-side or
  cleaner-side content was dropped by the merge.
- **Dependency-rule hard gate (BL-259):**
  `node extension/out/tools/dependency-gate.js test/bl984FixtureSweep.property.test.js
  test/bl984SweepStaleFixtures.test.js test/helpers/propertyLaneFixtureRunner.js`
  → **PASSED: no forbidden edges.**
- **Co-change coupling (BL-255):**
  `node extension/out/tools/co-change-report.js` over the same three files.
  One SUSPECTED COUPLING flag: `propertyLaneFixtureRunner.js` ×
  `specs/pipeline/steps/index.js` (3 co-changes). Judged expected, not a
  gap: the file is a step-registry entry point, and this parcel's own diff
  registers `bl984SweepStaleFixturesSteps` there — the same
  registration-pattern coupling every prior ticket touching this helper
  (bl868, bl871) shows in the same report. No other flag rises to the
  threshold beyond files this parcel authored together.
- **Declared invariants (BL-633/654), two declared:**
  1. "A property-lane fixture run's verdict is decided only by fixtures
     that run wrote itself..."
  2. "The sweep removes only files carrying the helper's own basename
     prefix in the helper's own fixture directory, and only those whose
     originating run is gone."

  Both have coder-authored, non-vacuous property tests in
  `extension/test/bl984FixtureSweep.property.test.js` (correct ownership
  per coder.prompt). Each generator is constructive by category
  (claimable/livePeer/siblingPrefix/unprefixed/malformed for invariant 2;
  same-prefix/other-prefix/single/many for invariant 1), with asserted
  reachability floors, not hoped-for coverage. I did not just trust the
  coder's non-vacuity claim: I broke invariant 2 myself (made the sweep
  claim every matching-prefix file regardless of `isPidAlive`/own-pid,
  i.e. removed the discriminator) and re-ran
  `npx vitest run --config vitest.properties.config.mjs
  test/bl984FixtureSweep.property.test.js` — the property test failed,
  reporting a live-peer file wrongly removed. Restored the file byte-for-
  byte (`git diff --stat` empty afterward) and re-ran green. Non-vacuity
  confirmed live, not assumed from the evidence note.
- **Property Testing pass (architect-owned, undeclared coverage):** the
  only pure module this parcel touches is `propertyLaneFixtureRunner.js`
  itself, already comprehensively covered by the two declared-invariant
  properties above. No additional property test is warranted — saying so
  rather than manufacturing a vacuous one.
- **Correctness read:**
  - Verified the zombie-pid fix (`kill(pid,0)` succeeds on a SIGKILLed-but-
    unreaped process; `isZombiePid` reads `ps -o state=` for `Z` and reads
    an unreadable/failed probe as *alive*, erring toward keeping a file
    it's unsure about) — reasoning is sound and matches the live unit test
    (`default aliveness treats a SIGKILLed-but-unreaped child (a zombie) as
    gone`, which I ran directly and it passed against a real spawned-then-
    SIGKILLed child).
  - Checked the "own pid counts as gone" assumption
    (`originPid === process.pid` claims the file) against actual
    concurrency: `vitest.properties.config.mjs` uses `pool: 'forks'`
    (confirmed by reading the config) — concurrent workers are genuinely
    separate OS processes with distinct pids, so two live invocations can
    never share a pid. The normal unit lane (`vitest.config.mjs`) also uses
    `pool: 'forks'` with `isolate: false`; that only lets multiple test
    *files* share one forked worker process sequentially, and `spawnSync`
    blocks that worker's entire event loop for the run's duration, so no
    other invocation in that same process can be mid-run even under
    `isolate:false`. No same-pid concurrent-invocation race exists in
    either lane's actual pool configuration.
  - Regex-reviewed `generatedName` against both entry points' real filename
    shapes (`${prefix}${pid}-${random}.property.test.js` and the runMany
    trailing `-${index}` variant) and confirmed a malformed/non-numeric pid
    segment and a same-directory non-prefixed human file both fail to
    match and are correctly left alone.
  - No correctness defect found.
- **Live verification (re-run independently, not trusted from the evidence
  note):**
  - Unit `npx vitest run --config vitest.config.mjs
    test/bl984SweepStaleFixtures.test.js` → **13/13 PASS**, including the
    live zombie case.
  - Property `npx vitest run --config vitest.properties.config.mjs
    test/bl984FixtureSweep.property.test.js` → **2/2 PASS**.
  - Acceptance `node specs/pipeline/cli.js
    specs/features/BL-984-sweep-stale-property-fixtures-before-run.feature`
    → **5/5 PASS** (all four scenarios, two-row Examples table on
    scenario 01).
  - **Direct real-world confirmation:** the five `bl868-fixture-74865-*`
    files this ticket was raised from (PID 74865, dead — present in this
    worktree since the BL-971 review and still present at the start of
    this review) were swept away as a side effect of exercising the real
    entry points during the verification above. Confirmed via
    `git status`/`ls` before and after: present beforehand, gone
    afterward, no trace left. The fix works against the exact artifact
    that motivated the ticket, not just its own planted fixtures.

## Notes, not send-back items

- **BL-971 provenance question** (`notes:`, a "worth checking" direction,
  not a `constraints:` firm line): the coder answered it and documented the
  full reasoning in `backlog/evidence/BL-984-coder-findings-20260821.md`
  §2 — no re-baselining needed, BL-971's cited figures are file-scoped and
  uncontaminated by the stranded fixtures. This was not additionally
  appended to BL-971's own ticket/evidence files; BL-971 is already closed
  (`backlog/done/`), and the answer is fully recorded and traceable from
  BL-984's evidence trail. Not a gap worth bouncing over.
- **Pre-existing orphaned `sleep 300` process** observed during review
  (pid 14008, started 10:54:18, parented to `babysitterd.sh`, predating
  every test invocation I ran this review) — a leftover OS process from an
  earlier verification pass in this shared worktree, not a fixture *file*
  leak (no corresponding file existed on disk), self-terminating on its own
  300s budget. Not caused by, and not in scope of, this parcel.
- `swarmforge/scripts/test/fixtures/` (untracked) is a different,
  Babashka/shell-side fixture system unrelated to this ticket's
  `extension/test/` property-lane fixtures — left untouched.

## Inventory result

**D1..Dn: NONE.** No architecture violation, no invariant violation, no
correctness defect.

Forwarding this commit (this evidence file, committed) to hardener per
Article 4.4 / BL-536 — never the bare received hash.

By architect.
