# BL-622 — QA bounce, 2026-08-06

Reviewed commit: ab214948 (documenter's forward; coder c3994d59 / cleaner
d77da209 / architect d52b9b7c / hardener cfe616c4 all confirmed ancestors).

## Complete review inventory (Article 4.4)

- **D1 — unit (own coverage regression)**: BLOCKING. See below.
- Acceptance: `node specs/pipeline/cli.js specs/features/BL-622-onboarding-telegram-token-separation.feature`
  → 7/7 scenarios pass (TAP). RUN, PASS.
- `.bb` unit suite: `bb swarmforge/scripts/test/fleet_telegram_creds_lib_test_runner.bb`
  → ALL TESTS PASSED. RUN, PASS.
- Shell suite: `bash swarmforge/scripts/test/test_front_desk_supervisor_bl622_refusal.sh`
  → ALL CHECKS PASSED, exit 0. RUN, PASS.
- Shell suite: `bash swarmforge/scripts/test/test_launch_front_desk.sh`
  → ALL CHECKS PASSED, exit 0 (architect's earlier bash-3.2 empty-array
  exit-1-despite-pass finding did not reproduce this run; pre-existing,
  already filed as a rule_proposal, not this ticket's concern either way).
  RUN, PASS.
- Step-handler wiring: `specs/pipeline/steps/index.js:383` requires
  `bl622OnboardingTelegramTokenSeparationSteps` — wired. CHECKED, PASS.
- Ancestry: `git merge-base --is-ancestor c3994d59 ab214948` and the same
  for d77da209/d52b9b7c/cfe616c4 all hold — the approved commit contains
  this ticket's own full chain, not a sibling's. CHECKED, PASS.
- Property-suite invariant coverage (2 properties, env-fallback gating +
  cross-swarm uniqueness): PASS in isolation (matches architect's 2/2).
- Full unit suite (`npm test`, extension/): 7088 passed, 9 failed across 8
  files. Of the 9: 8 (bounceDrain, bounceWatcher,
  dependencyGateCliReportsAndScope, dependencyGateCliStorageGlobals x1,
  renderBriefingDiagramsCli x3, startBridgeHeadlessCli) are in files this
  ticket's diff never touches (confirmed via
  `git log --oneline c3994d59..ab214948 -- <file>` = empty for each) and
  all 8 re-ran GREEN in isolation with a longer timeout — host load was
  62-180 on a 4-core box (`uptime`) for this entire pass, matching the
  documented host-load-flakiness precedent (BL-814's own QA pass, and the
  Stryker-dry-run-under-load lesson). Isolated as environmental, not this
  parcel's defect.
- Full `npm run test:properties`: 149 passed, 5 failed across 3 files —
  `bl760DuplicateChainGuard.property.test.js`,
  `bl787NamedTunnelInvariants.property.test.js`,
  `bl797MutationGateProbeCrashFallback.property.test.js`. None are BL-622
  files (confirmed via the same ancestor-diff check; these belong to
  BL-760/BL-787/BL-797, long pre-existing on `main`, last touched by their
  own tickets' commits 2e97da84/eaa2b53b/9df966d6). Re-ran isolated;
  failures persisted under continued severe load (62-88 avg, still ~20x
  the 4 cores) with subprocess-spawn/pidfile-timing assertions — consistent
  with the same environmental cause, not a BL-622 regression. Not blocking
  this ticket; not this parcel's own file.
- Orphan process check before/after: none found (`pgrep -fl 'node --test|stryker|vitest'`
  clean both times; the six live `bb` processes seen are the running
  swarm's own daemons/supervisors, not test artifacts).

## D1 — the ticket's OWN new file fails a real, unrelated-to-load regression guard

**Failing command:**
```
npx vitest run test/tmpDirMigrationGuard.test.js -t "zero raw mkdtemp"
```
(also reproduces as one of the 9 failures inside a full `npm test` run,
independent of host load — this is a deterministic assertion, not a
timeout.)

**Commit hash:** ab214948 (also present since coder's own c3994d59; every
downstream stage carries it unfixed).

**First error excerpt:**
```
AssertionError: expected zero raw mkdtemp call sites, found:
/Users/ldecorps/projects/swarmforgevc/.worktrees/QA/extension/test/bl622TelegramTokenSeparationInvariant.property.test.js:116

+ [
+   {
+     file: '.../extension/test/bl622TelegramTokenSeparationInvariant.property.test.js',
+     line: 116
+   }
+ ]
- []
 ❯ test/tmpDirMigrationGuard.test.js:118:10
```

**Failure class:** `unit`.

**Expected vs observed:** Expected zero raw `fs.mkdtempSync(...)` call
sites anywhere under `extension/test/` outside the shared `mkTmpDir`
helper (`test/helpers/tmpDir.js`) — the BL-420 migration-complete
regression guard. Observed one: line 116 of BL-622's own new
`bl622TelegramTokenSeparationInvariant.property.test.js` calls
`fs.mkdtempSync(path.join(os.tmpdir(), 'bl622-prop-other-primary-'))`
directly instead of routing through `mkTmpDir('bl622-prop-other-primary-')`
(already imported and used correctly at lines 108-109 of the same file, and
at line 62). This is not merely a lint nit: bypassing `mkTmpDir` also
means this one directory is never registered in `mkTmpDir`'s `pending`
list, so it is never swept by the shared per-test `afterEach` cleanup
(`test/helpers/tmpDirSetup.js`) — it leaks on every property-test run that
reaches the `'differs'` branch of `primaryRecordArb`.

**Remediation pointer:** `extension/test/bl622TelegramTokenSeparationInvariant.property.test.js:116`
— replace
`otherPrimaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl622-prop-other-primary-'));`
with
`otherPrimaryRoot = mkTmpDir('bl622-prop-other-primary-');`
(the `os` import may become unused afterward — check and drop it if so).

**Blamed role:** `coder` — the property test (including this line) was
authored in coder's own commit c3994d59 and every downstream role
(cleaner, architect, hardener, documenter) forwarded it unfixed. Architect
and hardener's evidence files show they each ran the BL-622 property test
by name (2/2) but never the full `npm test` suite that would have
surfaced this guard failure — noted here, not itself bounced, since QA
running the complete suite is exactly this gate's job.

## Verdict

BOUNCE D1 to **coder**. Everything else in this pass is PASS or isolated
as pre-existing host-load flakiness unrelated to this parcel's own files
— re-verify only D1 on return, not a full re-run of the isolated items
unless they regress again.
