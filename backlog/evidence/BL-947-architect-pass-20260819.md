# BL-947 architect pass — 2026-08-19

Reviewed commit: 25bd0fe8b (via cleaner's merge 10749c7a23, merged into
architect at [this commit]).

## Dependency-rule gate (BL-259, hard gate)
`node extension/out/tools/dependency-gate.js` against the parcel's changed
files (swarmforgeShErrorChannel.js, its guard/property tests, the BL-947
step handler, specs/pipeline/steps/index.js) reports 3 violations, all of
the same shape:

  telegram-front-desk-bot.ts -> telegramCursorOperatorExec.ts (acyclic)
  telegram-front-desk-bot.ts -> telegramCursorOperatorLiveness.ts (acyclic)
  telegramCursorOperatorExec.ts -> telegramCursorOperatorLiveness.ts (acyclic)

None involve any file this parcel touches. Confirmed pre-existing and
unrelated: a full-repo scan (no args) reports the identical 3 edges, and
`git log` on the three telegram files shows history back through BL-625/
BL-624/BL-892/etc — long before this session's work. No existing ticket
covers it (checked backlog/{active,paused,hold}/ and evidence/). Not a
BL-947 defect; not bounced for it. Surfaced instead via a priority-00 note
to specifier+coordinator, per the coder-notes precedent (BL-937/BL-938:
surface a defect a parcel uncovers rather than silently fixing or ignoring
it) — this is the read-only architect analogue of that same discipline.

BL-947's own diff introduces zero forbidden edges.

## Co-change report (informational, BL-255)
swarmforge.sh shows expected heavy coupling with other launcher/runtime
files (agent_runtime_lib.bb, swarm_ensure.bb, handoff_lib.bb, etc.) — its
normal profile as the central launcher, not a new coupling from this fix.
The new files (swarmforgeShErrorChannel.js + its tests + the BL-947 step
handler) co-change only with each other and this ticket's own touched
files. Clean.

## Two-layer / webview / secrets boundary
N/A — parcel touches only a shell script and pure Node modules. Confirmed
no `vscode` import in any new file.

## Invariants
- Invariant 1 (stdout carries values, never diagnostics): encoded as 4
  fast-check property tests in swarmforgeShErrorChannel.property.test.js,
  all pass (`npm run test:properties` scope). Non-vacuity documented
  in-file (break-then-fix checked by hand before landing).
- Invariant 2 (message text/exit status unchanged, channel-only): NOT
  encoded as a property test, with a stated, sound non-encodability
  rationale in the same file (quantifies over the diff's own scope, not a
  pure function's behaviour across generated inputs). Verified instead by
  the mechanical shape of the fix and acceptance scenario 02. Matches the
  invariants-review allowed exception.

## Fix shape
All 27 stdout `echo -e "${RED}Error:${RESET} ..."` sites in swarmforge.sh
now route through one `error_msg()` helper (`>&2`). Grep confirms zero
raw stdout error echoes remain. Message text, colour, exit statuses
byte-identical (diff-verified). The `2>&1` capture on the socket branch
(needed to capture the bb diagnostic into a variable) is untouched — only
its re-emission channel changed, per the ticket's explicit constraint.

## Standing guard
`extension/test/swarmforgeShErrorChannelGuard.test.js` — whole-script
guard (ticket's own request: "27 sites patched one at a time is how this
returns"), lives in the one suite every parcel runs, matches the
tempDirTrapGuard/tmuxReaperGuard/constitutionDocCitations precedent.
6/6 tests pass under `npx vitest run`.

## Acceptance
`specs/features/BL-947-swarmforge-sh-errors-reach-stderr.feature` — all 4
scenarios pass via `node specs/pipeline/cli.js <feature>`.

## Fork-deviation record
`docs/upstream-deviations.md` updated per Architecture Rule 2 (constraint
requirement). Correct shape, matches existing entries' format.

## Minor note (non-blocking)
Ticket description claims `ancillary_provider_lib.sh` has "one more" raw
stdout error echo with the same shape. Grepped the file: no `RED`/`echo -e`
pattern exists there at all. The coder correctly left it untouched;
qa_e2e_procedure step 9 already hedges this with "possibly". Not a defect,
just recording that the ticket's own count was inaccurate on this one file.

## Verdict
COMPLIANT. Forwarding to hardener.
