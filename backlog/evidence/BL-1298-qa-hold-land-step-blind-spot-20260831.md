# BL-1298 — QA hold: the land-step replay pulls in BL-1303's bounced, unlanded content

**Verdict: BL-1298's own work verified CORRECT and fully green. NOT landed.**
This is not a bounce — no defect found in coder/architect/hardener/documenter's
own BL-1298 work. The blocker is the shared land-step tooling sweeping a
still-bounced sibling ticket's content into the replay tip, discovered while
executing the BL-1241 land remedy on this ticket's cited commit — the same
shape BL-1307/BL-1300 hit on 2026-08-30.

## Independent verification of BL-1298's own work (all green)

- Merged documenter `7efbf30dfa` into `swarmforge-QA` as `86c2ed1c2d`;
  ancestry confirmed (BL-336 discipline): coder `fbc52c16b2`, architect
  `60659c9367`, hardener `f22afd345a` are all ancestors of `86c2ed1c2d`.
- `main`/`origin/main` in sync: `git rev-list --left-right --count
  main...origin/main` → `0 0`.
- `npm run compile` (extension/): clean.
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb`: ALL PASS.
- `bb swarmforge/scripts/test/bl1298_replay_worktree_property_runner.bb`:
  ALL PASS (40 runs, all six outcome branches reached non-degenerately).
- Acceptance: `run_acceptance.sh
  specs/features/BL-1298-the-replay-runs-from-a-linked-worktree.feature`:
  4/4 scenarios pass.
- `required_wiring` anchor confirmed live:
  `specs/pipeline/steps/index.js:909` requires
  `bl1298ReplayLinkedWorktreeSteps`; `replay!`'s live caller confirmed at
  `swarmforge/scripts/land_step_cli.bb:65`.
- Reviewed the actual diff of `land_step_lib.bb`'s `replay!`: both declared
  invariants are directly implemented (`git-common-dir` resolves the scratch
  path via `git rev-parse --git-common-dir` instead of assuming `.git` is a
  directory; `drop-branch!` now runs on every failure path, including the
  create-failure path that used to return early and leak the branch).
- Architect and hardener evidence files reviewed
  (`backlog/evidence/BL-1298-the-replay-runs-from-a-linked-worktree-{architect,hardener}-pass-20260831.md`):
  both independently ran the same bb runners and acceptance suite, confirmed
  the required_wiring anchor and non-vacuity of both invariants, no
  send-back.
- Documenter evidence reviewed: `docs/reference/Specification.MD` gained the
  missing changelog entry; no how-to subsection needed (matches BL-1295/
  BL-1297 precedent, not BL-1308's); no diagram change-trigger fired.
- Whole-suite unit (`npm run test`) and property (`npm run
  test:properties`) baselines: 15 unit files / 25 tests and 26 property
  files / 15 named tests fail, **none of them touched by this parcel's
  32-file diff** and every failure traced to already-ticketed standing debt:
  BL-1229 (`deps.checkOrphanedAuthoredDocs is not a function`, 10 files),
  BL-1263 (backendSwitch/telegramClient/telegramCursorOperatorExec stale
  assertions), BL-1265 (operatorRuntimeBbFixtureClosure), BL-1290
  (socketFixtureShortRootGuard), BL-1291 (liveRepoDerivationGuard), BL-1289
  (tempDirTrapGuard), the BL-1172 deprecator-epic's still-empty
  `docs/deprecated/` (constitutionDocCitations), and the property lane's
  `require('node:test')` collection break tracked under BL-1206/1220/1221
  (alertTelemetry, bl735PilotAcceptanceExecution, bl1146HostQueueEnqueueNext,
  bl1147ProbeLegacyTopicAdoption, crossFileDuplicationCheck,
  bl782LivenessProbesScopedToRoot, pilotScopedCrapEvidence,
  shellEntryPointDriveCheck, pilotAcceptanceGate,
  bl1150OutageFailoverCliLoadFileSafe, bl669OutageFailoverSteward,
  bl1200FixtureGitWritesStayInOwnRepo, bl733ProducerCrosscheck,
  resolveMutationConcurrency). Per BL-1063, presumed already-ticketed and
  confirmed by grep in every case; not re-reported.
- Orphan process check clean before and after (`pgrep -fl 'node
  --test|stryker'`).

## The land-step defect (BL-1308-shaped)

Ran `bb swarmforge/scripts/land_step_cli.bb
BL-1298-the-replay-runs-from-a-linked-worktree 86c2ed1c2d` from **inside
this linked worktree, with no third repo-root argument** — the exact
scenario this very ticket fixes, and a good live test of it: the tool ran
successfully from the linked worktree (the old bug this ticket fixes would
have failed outright with "could not create worktree"). Result:

```
LAND_REPLAY land-replay/BL-1298-86c2ed1c2d adb6e0beff01e32fe92cff5476fa7d9f725158c1
ENTANGLED_SIBLING BL-1303
ENTANGLED_SIBLING BL-1305
```

**BL-1305 is harmless.** `backlog/done/BL-1305-fixture-agent-binary-is-the-stub.yaml`
is already closed and landed on `origin/main` (`d5bdf71efa`, `4a90e02199`,
`8adc1dea91`, all confirmed ancestors of `origin/main`). Diffing the replay
tip against `origin/main` by name finds zero BL-1305-attributable files —
it contributes no content, only an ancestry mention. Not a blocker.

**BL-1303 is the problem.** `backlog/active/
BL-1303-a-feature-on-main-always-has-a-registered-handler.yaml` is `status:
todo`, `human_approval: approved` but **currently bounced** — architect
bounce evidence dated today
(`backlog/evidence/BL-1303-a-feature-on-main-always-has-a-registered-handler-bounce-20260831.md`),
defect D1: `required_wiring` anchor 2 (the `pre-merge-commit` hook wiring)
unmet. The replay tip `adb6e0beff01e32fe92cff5476fa7d9f725158c1` diffed
against `origin/main` (`git diff origin/main
adb6e0beff01e32fe92cff5476fa7d9f725158c1 --stat`) includes, alongside
BL-1298's own 9 files, BL-1303's own production files — none present on
`origin/main`:

    extension/src/tools/check-feature-handler-registration.ts
    extension/src/tools/featureHandlerRegistrationCheck.ts
    extension/src/tools/featureHandlerRegistrationReport.ts
    extension/src/tools/featureHandlerRegistrationText.ts
    extension/src/tools/featureHandlerRegistrationTypes.ts
    specs/pipeline/steps/bl1303FeatureHandlerRegistrationSteps.js
    swarmforge/scripts/check_feature_handler_registration.sh
    swarmforge/scripts/run_commit_guards.sh (wires the guard into the
      commit-guard chain)
    swarmforge/scripts/test/test_check_feature_handler_registration.sh
    plus BL-1303's own test/evidence/ticket files

and — confirmed directly — this is specifically the **bounced, incomplete**
version: the post-bounce re-fix commits that add the missing
`pre-merge-commit` wiring (`a09a7653a8`, `652603514d`, `4e3172dc96`,
`8c83d7faf2`, "cleaner pass — no defect found") are **not ancestors** of
`86c2ed1c2d`, and `swarmforge/git-hooks/pre-merge-commit` in this worktree
has no `check_feature_handler_registration` reference. Landing the replay
tip as cited would ship BL-1303's own-known-incomplete guard implementation
onto `origin/main`, under BL-1298's ticket, bypassing BL-1303's own QA gate
entirely — the same class of silent bypass BL-1308 was minted for.

Root cause: `land_step_lib.bb`'s sibling detector correctly named BL-1303
here (unlike BL-1307/BL-1300's total invisibility) — the detector-visibility
half BL-1308 targets does appear to be working. But the replay's own-path
computation (`task_scope_gate_lib.bb`'s `:delivered`, diffing a merge
against its first parent only) still sweeps the second-parent sibling's
content into the tip regardless. Per BL-1307's own disposition, a named
entangled sibling is not proof the tip is clean — this hold is that check,
done by hand, per that written guidance.

## Why this is not a bounce, and not a hand-rolled fix

`land_step_lib.bb`/`task_scope_gate_lib.bb` are shared swarm machinery, not
BL-1298's own deliverable — no role in this ticket's chain owns a fix here
(and, notably, BL-1298 is itself part of the tooling this remedy depends
on — this ticket cannot fix its own tooling's remaining hole). Stripping
BL-1303's files out of the replay tip by hand is exactly what QA.prompt
forbids ("this remedy has a tool, do not hand-roll the replay") and would
land an unreviewed guess about which lines are safe to keep.

## Disposition

**QA HOLD.** `86c2ed1c2d` sits merged into `swarmforge-QA`, verified, not
reverted — no defect in BL-1298's own work. Not landed. Not forwarded.
`land-replay/BL-1298-86c2ed1c2d` (commit
`adb6e0beff01e32fe92cff5476fa7d9f725158c1`) left in place, unlanded, as
inspectable evidence — do not land it as cited.

This resolves itself once BL-1303 lands for real (its corrected,
`pre-merge-commit`-wired version): at that point BL-1303's files are already
on `origin/main`, the replay's inclusion of them becomes byte-identical
rather than novel, and `86c2ed1c2d` needs no re-work — re-run
`land_step_cli.bb` on the same cited commit.

Sent specifier a `note`, priority `00`, naming this evidence file and the
one open blocker: BL-1303's own bounce must be resolved and land before
BL-1298 can land.

By QA.
