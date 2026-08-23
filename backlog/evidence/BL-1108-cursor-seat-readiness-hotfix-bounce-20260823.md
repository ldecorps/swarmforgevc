# BL-1108-cursor-seat-readiness-hotfix — QA bounce — 20260823

Full Article 4.4 pass after documenter tip `9d0264d9c3` (already merged on
QA as `258de5b062`). Every gate below was actually run or is recorded with
its blocker; this is the complete inventory, one bounce.

## Gates run

- Sibling check: `node extension/out/tools/qa-sibling-check.js status
  --ticket BL-1108` → `VERIFY BL-1108` (exit 0).
- `merge_and_process documenter 9d0264d9c3`: tip already ancestor of HEAD
  (`258de5b062`); no second merge needed.
- Compile: `cd extension && npm run compile` — clean.
- Shell/Babashka unit (parcel surface):
  - `bb swarmforge/scripts/test/agent_process_marker_lib_test_runner.bb` — OK
  - `bash swarmforge/scripts/test/test_babysitter_check.sh` — ALL PASS
  - `bash swarmforge/scripts/test/test_remote_control_health.sh` — ALL PASS
  - `bb swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb` — reached
    after ensure failure; not re-run once RC-6 failed (BLOCKED BY D1 for a
    clean full `test_swarm_ensure.sh` green).
  - `bash swarmforge/scripts/test/test_swarm_ensure.sh` — **FAIL RC-6** (D1).
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1108-cursor-seat-readiness-hotfix.feature` — 4/4 PASS.
- Properties (parcel): `npx vitest run --config vitest.properties.config.mjs
  test/bl1108CursorSeatReadiness.property.test.js` — 2/2 PASS.
- Properties (whole lane): `cd extension && npm run test:properties` — 167
  files / 489 tests PASS. Two unhandled `[vitest-worker]: Timeout calling
  "onTaskUpdate"` errors — exact known benign artifact (engineering.prompt),
  allowlisted; exit 0.
- Unit (whole lane, with swarm.env):
  `cd extension && set -a && . /home/carillon/swarmforgevc/.swarmforge/swarm.env
  && set +a && node scripts/recordTestDuration.js` — **7 failed / 8734
  passed**. Failures are `sampleResourcesCli.test.js` (3) and
  `strykerSandboxSiblingsLib.test.js` (4). Neither path is in the BL-1108
  stamp-off diff (`git log 4d53be3a4f^..HEAD` touches neither). Standing /
  outside parcel — see Outside parcel below. Not charged to this bounce.
- `required_wiring`
  `specs/pipeline/steps/index.js::bl1108CursorSeatReadinessSteps` —
  registered; exercised by the acceptance run above.
- Ticket ancestry of tip: coder `4d53be3a4f`, hardener `bd632c39f8`,
  documenter `9d0264d9c3` are ancestors of `258de5b062`.
- Docs currency (documenter pass): BL-611 / BL-514 how-tos, Specification.MD,
  architecture.mmd, docs/index — present on tip; not disputed by D1 (docs
  correctly describe non-Claude OFF; D1 is Claude-with-RC-deliberately-off).
- Live `qa_e2e_procedure` pack spin (steps 2–5): not separately launched;
  BL-112 executable form is the acceptance feature. Not a separate defect
  while D1 already refutes stamp-off readiness.
- Orphans: no `node --test` / `stryker` left running after this pass.

## D1 — Claude seat with RC deliberately off now reports `rc:` OFF (Cursor copy) instead of HEALTHY (unit, blame: coder)

Hotfix `f02f6ae5b4` changed `ensure-rc-role!` so a nil
`expected-rc-name` (launch script has no `--remote-control`) always returns
`:off` with action `"no Claude /rc; heal via agent:; phone via Cursor Remote"`.
Before the hotfix that short-circuit reported `:healthy` (BL-514 RC-6:
Claude seat with RC off by config is satisfied / not probed).

RC-6 fixture uses `roles.tsv` agent `claude` and
`exec claude --dangerously-skip-permissions` (no RC flag). Observed report:

```
rc:coder: OFF (no Claude /rc; heal via agent:; phone via Cursor Remote)
```

Ticket invariant 2 requires OFF for **non-Claude** seats only. A Claude seat
with RC deliberately off must keep the BL-514 HEALTHY short-circuit (and must
not probe). Stamp-off acceptance/properties never cover that Claude-off case,
so the regression rode the chain green until QA ran `test_swarm_ensure.sh`.

**Remediation (coder):** in `swarmforge/scripts/swarm_ensure.bb`
`ensure-rc-role!`, when `expected-rc-name` is nil, report `:off` only for
non-Claude agent tokens (via `role-agent-token` / shared marker lib); keep
`:healthy` (and no probe) for Claude. Extend stamp-off acceptance or
`test_swarm_ensure.sh` so Claude-RC-off cannot regress again. Do not redesign
babysitter/ensure beyond that narrow gate.

### Five fields

1. **Failing command:**
   `env -u SWARMFORGE_CONFIG bash swarmforge/scripts/test/test_swarm_ensure.sh`
2. **Commit hash:** `258de5b062` (QA tip holding documenter `9d0264d9c3` /
   hardener `bd632c39f8` / stamp-off lineage including hotfix `f02f6ae5b4`).
3. **First error excerpt:**
   ```
   FAIL: RC-6: a launch script declaring no --remote-control flag was not
   reported HEALTHY; got: extension: HEALTHY
   agent:coder: HEALTHY
   rc:coder: OFF (no Claude /rc; heal via agent:; phone via Cursor Remote)
   daemon: HEALTHY
   launch-contract: HEALTHY
   operator: HEALTHY
   babysitterd: HEALTHY
   ```
4. **Failure class:** `unit`
5. **Expected vs observed:** Expected `^rc:coder: HEALTHY$` with no cmdline
   probe (BL-514 RC-6); observed `rc:coder: OFF (...Cursor Remote...)` for a
   Claude seat whose launch script simply omits `--remote-control`.

## Outside parcel (not bounce items)

- Extension unit reds under swarm.env (`sampleResourcesCli`,
  `strykerSandboxSiblingsLib` EEXIST): not in BL-1108 diff; same class of
  host/standing noise noted on recent QA passes (e.g. BL-1081 evidence).
  Grep of `backlog/{paused,active,hold,debt}` for those basenames was empty;
  they remain outside this stamp-off's ownership and are not D2.

## Degraded gate (ticket-stated)

Shell/Babashka slice: no mutation/CRAP/DRY tooling wired; gate is project
runners + acceptance (already recorded by hardener). Not a defect.

By QA.
