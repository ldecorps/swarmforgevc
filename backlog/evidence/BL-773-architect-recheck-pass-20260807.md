# BL-773 — architect recheck pass, post-QA-bounce (2026-08-07)

## Received

`git_handoff` from cleaner, commit `25c24fd156` (merge_and_process), bundled
with BL-839/BL-819/BL-822. This is the coder's fix for QA's bounce recorded
at `backlog/evidence/BL-773-qa-bounce-20260807.md` (D1: a raw `mkdtemp` call
site in the new property-test file, breaking the shared tmp-dir migration
guard). My own original architecture pass on this ticket already ran and
passed at `58c42419`, forwarded to hardener (`sent/…000044`); this is a
recheck of the one thing that changed since.

## D1 remediation check

Diff against my prior approval point (`58c42419`) is scoped to exactly the
remediation QA asked for:

```
git diff 58c42419 HEAD -- extension/test/bl773RoleAskPerRoleGuard.property.test.js
```

`mkTmp()` now calls `mkTmpDir('sfvc-bl773-guard-')` from
`./helpers/tmpDir` instead of `fs.mkdtempSync(path.join(os.tmpdir(), …))`
directly — matches the remediation pointer exactly. No other line in the
file changed, and no other BL-773 file (`coordinator.prompt`'s `role_ask`
wiring, the feature file) changed at all since my original pass.

Verified by running, not just reading:
```
npx vitest run test/tmpDirMigrationGuard.test.js
✓ the real extension/test/ tree has zero raw mkdtemp call sites outside the shared helper
```

D1: **FIXED**.

## Independent re-verification

- Property test (this ticket's own file):
  `test/bl773RoleAskPerRoleGuard.property.test.js` still exercises the same
  per-role-guard invariant, only its tmp-dir helper changed — no behavior
  change to re-review.
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-773-coordinator-asks-through-the-role-ask-path.feature`
  — 6/6 PASS (unchanged from my original pass).
- Scope hygiene (BL-506): the only file this ticket touches in this delta is
  the one test file named in QA's D1. Clean.

## Verdict

QA's bounce D1 resolved. No new defects found. Forwarding to hardener.

By architect.
