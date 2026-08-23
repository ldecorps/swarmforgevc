# BL-1081-an-acp-host-in-a-pane-can-drive-one-seat — QA bounce — 20260823

Full Article 4.4 pass after documenter re-forward `05ba98d54a` (QA merge
`5e59e71fe2`). Every gate below was actually run or is recorded with its
blocker; this is the complete inventory, one bounce.

## Prior bounce D1 (launch wiring) — CLEARED

Previous QA bounce (`f52ed3a84e`, earlier evidence under this basename today)
said nothing in production spawned the ACP host. That gap is closed on this tip:

- `swarmforge/scripts/swarmforge.sh` `write_role_launch_script` vibe branch
  launches `extension/out/tools/acp-host-pane.js` (comment cites the prior QA
  bounce D1; pane process is the host, vibe is its ACP subprocess).
- TS decision surface: `shouldLaunchViaAcpHost` in
  `extension/src/swarm/acpSeatLaunch.ts`; babashka twin:
  `acp-hosted-spike-seat?` in `swarmforge/scripts/prompt_engine_lib.bb`.
- Acceptance scenario 05 embeds a live-source grep that the vibe branch
  names `acp-host-pane.js` (passes).

## Gates run

- Sibling check: `node extension/out/tools/qa-sibling-check.js status
  --ticket BL-1081` → `VERIFY BL-1081` (exit 0).
- `cd extension && npm run compile`: clean.
- Unit (`cd extension && set -a && . /home/carillon/swarmforgevc/.swarmforge/swarm.env
  && set +a && node scripts/recordTestDuration.js`):
  **3 files / 8 tests red** (see D1 and Outside parcel). Without swarm.env,
  bridge suites also red on missing `CURSOR_API_KEY` — environment, not
  parcel; the env-sourced run is the unit gate of record.
- Properties (`cd extension && npm run test:properties`): 164 files / 480
  tests green. Two unhandled `[vitest-worker]: Timeout calling
  "onTaskUpdate"` errors — exact known benign artifact
  (engineering.prompt), allowlisted.
- Acceptance: `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1081-an-acp-host-in-a-pane-can-drive-one-seat.feature`
  — 5/5 scenarios pass.
- `pgrep -af 'node --test|stryker'` before/after: no orphan test/mutation
  procs left by this pass.
- `required_wiring` `specs/pipeline/steps/index.js` →
  `bl1081AcpHostDrivesOneSeatSteps`: registered; exercised by acceptance.
- `required_wiring` live babysitter site: `swarmforge/scripts/babysitter_check.bb`
  load-files `acp_session_lib.bb`; `gather-role` uses
  `acp-session-lib/read-snapshot`, `menu-check-applies?`,
  `apply-acp-facts`. Intent satisfied at the live site.
- Ticket ancestry of tip: hardener `e2a96cb7bc`, coder launch
  `1fe9f295ec`, documenter `05ba98d54a` are all ancestors of `5e59e71fe2`.
- Live pack `qa_e2e_procedure` steps 1–4 (tmux seat behind host): not
  separately launched this pass; BL-112 executable form is the acceptance
  run above, which now also locks the production launcher naming the host.
  Not recorded as a defect: prior D1 was the blocker for attempting live
  control-channel falsification, and it is cleared in code.

## D1 — new ACP host unit test uses raw `mkdtemp`, failing the repo-wide temp-dir migration guard (unit, blame: coder)

`extension/test/acpHostPane.test.js` (this parcel) allocates fixtures with
raw `fs.mkdtempSync(path.join(os.tmpdir(), ...))` instead of the shared
`extension/test/helpers/tmpDir.js` `mkTmpDir` helper (BL-420). That trips
the standing guard:

```
FAIL  test/tmpDirMigrationGuard.test.js > the real extension/test/ tree
  has zero raw mkdtemp call sites outside the shared helper
AssertionError: expected zero raw mkdtemp call sites, found:
  .../extension/test/acpHostPane.test.js:21
```

Sibling ACP tests in this parcel do not show the same raw call; only this
file. Fix: route `mkRepo()` through `mkTmpDir('bl1081-acp-host-')` (or
equivalent shared helper), keep the guard green.

### Five fields

1. **Failing command:**
   `cd extension && set -a && . /home/carillon/swarmforgevc/.swarmforge/swarm.env && set +a && node scripts/recordTestDuration.js`
   (single-file repro:
   `cd extension && npx vitest run test/tmpDirMigrationGuard.test.js`)
2. **Commit hash:** `5e59e71fe2` (QA merge of documenter `05ba98d54a` onto
   swarmforge-QA).
3. **First error excerpt:** see assertion block above
   (`acpHostPane.test.js:21`).
4. **Failure class:** `unit`
5. **Expected vs observed:** Expected zero raw mkdtemp call sites under
   `extension/test/` outside the shared helper. Observed one at
   `acpHostPane.test.js:21`, introduced by this parcel's host CLI coverage.

### Remediation pointer

`extension/test/acpHostPane.test.js` line 21 — replace raw
`fs.mkdtempSync(path.join(os.tmpdir(), 'bl1081-acp-host-'))` with
`require('./helpers/tmpDir').mkTmpDir('bl1081-acp-host-')` (same pattern as
other extension tests). Owning role: **coder** (introduced the test).

## Outside parcel (not bounce items — BL-1063)

Same unit run, after swarm.env:

- `test/sampleResourcesCli.test.js` — 3 deterministic fails (`SAMPLED 0
  role(s)` / line-count). Diff `HEAD^1..HEAD` does not touch this file.
- `test/strykerSandboxSiblingsLib.test.js` — 4 deterministic fails
  (`EEXIST` on stale-symlink replace). Diff does not touch this file.

`grep -rl 'sampleResourcesCli\|strykerSandboxSiblingsLib'
backlog/{active,paused,hold}` is **empty** (noted again in BL-1099 QA
evidence the same day). Surfacing to coordinator as untracked standing
debt; not charged to BL-1081.

## Inventory summary

| Item | Class | Blamed role | Disposition |
|------|-------|-------------|-------------|
| D1 raw mkdtemp in `acpHostPane.test.js` | unit | coder | bounce |
| Prior launch-wiring D1 | behavior | — | cleared |
| sampleResources / strykerSandbox | unit | — | outside parcel; untracked |

By QA.
