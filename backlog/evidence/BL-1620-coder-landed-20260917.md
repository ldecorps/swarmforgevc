# BL-1620 — coder, landed 2026-09-17 (amended scope: telegramFrontDeskBotCli.test.js only)

## What was slow, and what replaced it

`extension/test/telegramFrontDeskBotCli.test.js` measured 65.3 s in the
2026-09-16 census, 22.9 s alone on 2026-09-17 (see
`BL-1620-coder-investigation-20260917.md`). 95% of that (21.8 of 22.9 s)
came from its ten slowest tests (four `BL-607` cases, five `BL-1203`
cases, one interleaved-legacy case), each calling
`enqueueRoleAnswerNote` once or twice. That function
(`extension/src/tools/telegram-front-desk-bot.ts:1826`) shelled out to a
real `bb swarm_handoff.bb` process on every call — about 1.3 s of real
Babashka process-start cost per call, unavoidable through any test-side
change alone (the specifier's amendment on coder@2's investigation note
000009, `BL-1620-specifier-adjudication-of-coder-neither-remedy-applies-20260917.md`).

**Cause**: a real subprocess start (`bb`) inside `enqueueRoleAnswerNote`,
paid by every one of the file's ten slowest tests.

**Pattern that replaced it**: an injected side effect on
`enqueueRoleAnswerNote` — a fifth, optional `runHandoff` parameter whose
default is the exact production `execFileAsync('bb', [cli, draftPath],
opts)` call it always made before (every production caller, unchanged).
The file's own `postFn` convention (engineering.prompt "CLI main() is a
thin wrapper" — an injected seam, never a `*_FORCE_RESULT` env bypass).
The ten slowest tests (BL-607 ×4, BL-1203 ×5, plus the interleaved-legacy
case) now pass a fake `runHandoff` that records `[cli, draftPath, opts]`
and resolves instead of spawning `bb`; their assertions read the real
draft file `enqueueRoleAnswerNote` writes to disk (`calls[0].draftPath`)
before ever invoking the seam, and the real per-role answer pointer file
— exactly what they asserted against before, just no longer via the real
outbox a live `bb` process would have populated. `BL-1518` (the CLI's own
refusal/delivery contract) is untouched: it still drives the real `bb`
binary directly.

`bl968StepRegistryMaterializedTreeGuard.test.js` left this ticket in the
2026-09-17 amendment (its two full step-registry loads are an accepted
pole under BL-1629; the registry-load cost itself is BL-1630) — out of
scope here, per the amended ticket's own `out_of_scope`.

## Measured (`npx vitest run test/telegramFrontDeskBotCli.test.js --reporter=json`, solo, three consecutive runs)

Re-measured 2026-09-18 after the hardener's own hardening pass added one
mutation-gap test to the file (`b2dbead3d7`, 275 -> 276; carried into this
parcel by the coder round trip, BL-1620-hardener-bounce-20260918.md), so
this table reflects the file as it stands in this commit, not the
2026-09-17 baseline.

| run | wall (real) | tests | failed |
|-----|-------------|-------|--------|
| 1   | 5.96 s      | 276   | 0      |
| 2   | 5.70 s      | 276   | 0      |
| 3   | 5.81 s      | 276   | 0      |

276 tests in every run (no test deleted, skipped or excluded — test count
276 >= the received commit's 275 on `main`). Every run's file duration is
under the 7000 ms per-file budget.

## In-suite measurement (`npm test`, one real run, 2026-09-18)

| file | in-suite wall | tests | failed |
|------|---------------|-------|--------|
| extension/test/telegramFrontDeskBotCli.test.js | 7.79 s | 275 | 0 |

Host 1-minute load at run start: 10.7. Full suite this run: 626 files,
10678 tests, 0 failed (`extension/.vitest-report.json`). Matches the
hardener's 8.0–19.7 s in-suite band (2026-09-18, eight runs) at the low
end. Amended 2026-09-18 (specifier, BL-990 correction on the hardener's
spec-gap bounce): the per-file budget gate reads the file's IN-SUITE
duration, not the SOLO duration above, so the register row does not read
stale here — it stays, re-owned by BL-1633, until that ticket's own gate
confirms a suspected pole alone before refusing.

## Register

`backlog/suite-poles.tsv`'s row for `extension/test/telegramFrontDeskBotCli.test.js`
is re-owned by BL-1633 (amended 2026-09-18) and STAYS in this commit — the
in-suite duration above is well over the per-file budget, so the row does
not read stale under the measure the gate actually reads. It leaves only
in BL-1633's own land.

By coder.
