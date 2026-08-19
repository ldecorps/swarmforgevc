# BL-915 hardener pass — 2026-08-19

## Reviewed commit
`090e3b48b` merge of architect `418b6d1992` into hardener. Stamp-off for
hotfix `ece61cbe63` (`isCursorAgentGone`/`shouldResetCursorAgentSession`,
`extension/src/tools/telegramCursorBridgeCore.ts`). Per the architect's own
finding, this parcel's own diff touches no production file — only the new
acceptance step handler and its `index.js` registration. The gates this
ticket exists to run apply to the hotfix's already-landed production code,
not to this parcel's own diff.

## Mutation gate (BL-149) — SKIPPED, unconditional cooldown
Ran `mutation_cooldown_gate.bb` against the hotfix's production file:

```
DECISION: skip-cooldown
file_age_days: 1.62 (cooldown: 3 days)
load_avg: 8.91 cores: 4 busy_threshold: 2.00x (busy)
```

`telegramCursorBridgeCore.ts` was last committed-touched 1.62 days ago —
inside the 3-day cooldown window. Per the standing rule this is
unconditional: **do not mutation-test it this pass, regardless of host load
or time of day**. This is the correct, deliberate outcome, not a shortcut:
the hotfix is 2 days old and the file may still be actively churning (this
is exactly the class of file the cooldown exists to protect from premature
stabilization). No Stryker run attempted, no mutation manifest touched.

This is worth flagging explicitly because BL-915's own `approval_context`
names the mutation pass as "the hardener's real work" — the cooldown gate
is a standing rule that overrides that expectation for this pass. **A
follow-up mutation pass against `telegramCursorBridgeCore.ts`'s
`isCursorAgentGone` predicate is still owed once the file clears cooldown**
(≈2026-08-20 afternoon, 3 days after the hotfix commit). Flagging via `note`
to specifier/coordinator alongside the `git_handoff`, so this doesn't get
silently treated as "hardened" when the actual mutation-testing work has
not run.

## CRAP gate — deferred, host busy
`npm run crap` requires a full `npm run coverage` run (`vitest run
--coverage` over the entire extension suite) first — a full-suite run, not
a targeted one. `uptime` throughout this pass stayed at 8.9–19 (1/5/15-min)
on 4 cores, above the 2x-cores busy threshold the whole time. Per the load
rules (bind every full-suite/mutation run) and the office-hours bypass,
deferred to a quiet pass rather than run now. Same disposition as the
mutation gate above — owed, not skipped.

## DRY (jscpd) — ran, no new duplication from this ticket
`npx jscpd --config .jscpd.json src` (lightweight static scan, not a
full-suite run): 35 clones repo-wide, 0.74% duplicated tokens. One clone
touches `telegramCursorBridgeCore.ts:143-149` against
`telegramCursorOperatorCore.ts:132-139` — pre-existing, nowhere near the
hotfix's own lines (878-889 per the architect's evidence), and outside this
parcel's diff entirely (this parcel changes no production file). Not a
regression this ticket introduced; not this stamp-off ticket's to refactor
(out_of_scope: "does not redesign the classifier").

## Targeted-test hardening performed instead
1. `npm run compile` — clean, no errors.
2. Targeted unit re-run (no coverage instrumentation, cheap under load):
   `npx vitest run test/cursorBridgeAgentSession.test.js
   test/telegramCursorBridgeCore.test.js` → **169/169 pass**, matches the
   architect's and coder's claims exactly.
3. Acceptance pre-check, full run via
   `node specs/pipeline/cli.js specs/features/BL-915-cursor-bridge-gone-agent-session-reset.feature
   specs/pipeline/generated specs/pipeline/steps/index.js` → **10/10
   scenarios pass**, matches the architect's claim exactly.
4. Fixture hygiene: no `sfvc-bl915-*` directories left under `/tmp` or
   `/var/folders` after the run; `git status --short` clean; no orphaned
   `node --test`/`stryker`/`vitest` process in this worktree afterward (one
   unrelated `node --test` process was observed running BL-937's generated
   test in the **QA** worktree — a different role's own in-flight work, not
   mine to touch).

## Verdict
No new defect found in this parcel's own diff (the acceptance step handler
and registration). Both pre-existing invariants continue to hold under
independent targeted re-run, matching the architect's findings exactly. The
two gates this ticket exists to satisfy that require expensive tooling —
Stryker mutation and CRAP — could not run this pass: mutation is
unconditionally blocked by the BL-149 cooldown gate (file age 1.62 days <
3-day cooldown), CRAP requires the same full-coverage run and the host
stayed busy throughout. Neither is a defect; both are owed on a later pass
(mutation after ≈2026-08-20, CRAP on the next quiet host) and are flagged
via `note` alongside this handoff so the gap is not silently dropped.

Forwarding to documenter.

By hardener.
