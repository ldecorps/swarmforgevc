# BL-1058 — architect pass, follow-up observation (not a bounce)

Reviewed merge `d2f320cc6` (cleaner `11fad6cb48`, coder `6597fc926e`).
Architecturally clean, both declared invariants are backed by real,
non-vacuous property tests, and the required wiring
(`bl1058PortableMktempSteps` registered in `specs/pipeline/steps/index.js`)
is present. Verified independently, not just trusted from the parcel's own
claims:

- `dependency-gate.js` per-parcel scope (`extension/test/bl1058Tmp...`):
  clean, no forbidden edges.
- `dependency-gate.js` full-repo scan: 3 pre-existing `acyclic` violations
  among `telegram-front-desk-bot.ts` /
  `telegramCursorOperatorExec.ts` / `telegramCursorOperatorLiveness.ts` —
  none of this parcel's files, already ticketed as BL-759.
- `co-change-report.js` on the changed files: the only flagged coupling is
  `tmp_cleanup.sh` × `specs/pipeline/steps/index.js` (frequency 3) — the
  expected "every new step handler touches the registry" pattern, not a new
  concern.
- `bash swarmforge/scripts/test/test_tmp_cleanup_lib.sh`: 17/17 PASS on this
  GNU/Linux host, including the new BL-1058 dialect-shim scenarios (07/08/09)
  exercising GNU, BSD, and a refusing mktemp.
- Direct confirmation the fix actually resolves the described defect: ran
  `bash swarmforge/scripts/test/test_bounce_bridge_headless.sh` (one of the
  83 suites the ticket says was dark) before vs after — dies at source time
  before the fix's ancestor, 12/12 PASS at this commit.
- `node specs/pipeline/cli.js specs/features/BL-1058-...feature`: 9/9
  acceptance scenarios PASS.
- `npx vitest run --config vitest.properties.config.mjs` on the new property
  file: 3/3 PASS, including both declared invariants. Non-vacuity is
  documented in-file (three deliberate breaks, each restored) rather than
  merely asserted.
- Full `npm run test:properties`: 419/420 PASS, 143 files. The single
  `Unhandled Error` in the run is exactly the BL-871 benign
  `[vitest-worker]: Timeout calling "onTaskUpdate"` artifact — allowlisted,
  not a lane failure. (An earlier run of this same command showed 11
  spurious "Cannot find module .../bl871-fixture-*.property.test.js"
  failures; those were self-inflicted by my own prior invocation hitting a
  tool-side timeout mid-run, leaking BL-984 fixture files exactly the way
  BL-971's own writeup describes ("a killed run leaves it for the next run
  to collect as a false red"). A clean, uninterrupted run left no such
  debris and showed only the one failure below.)

## The observation

The one real failure — `bl796NvmNodePathFollowUpAdoptInvariants.property.test.js`,
invariant 1 ("the launched daemon inherits a PATH on which both bb and node
resolve") — is reproducible in isolation (not flaky) and pre-dates this
parcel: BL-1058 touches only `tmp_cleanup.sh` and its own test/shim/property
files, none of which `bl796`'s test or its target
(`swarmforge/scripts/operator_path_lib.sh`) reference.

The failure: with caller `PATH="/usr/bin:/bin"`, the property expects
`operator_path_lib.sh` to resolve `node` from a fake nvm tree it constructs,
but on this host `/usr/bin/node` is a real, executable Node.js binary (this
WSL2/Linux box ships one at that exact path) — so the "minimal PATH with no
node on it" premise the generator assumes no longer holds here, and the
library correctly finds the real system node first.

This looks like the same failure CLASS BL-1058 itself fixes: a
correctness-relevant assumption authored and verified on one host that
silently broke when **this host moved to WSL2/Linux on 2026-08-22** — BL-1058's
own description names that exact migration date for the `mktemp` defect.
`BL-796` is already `status: done` (shipped), so this is a live regression
in a closed ticket's own property test, not merely a design gap.

## Why this is a note, not a bounce

`bl796`'s file and its target library are entirely outside this parcel's
diff — the coder correctly touched only what BL-1058 scopes. Bouncing this
parcel to fix an unrelated shipped feature's regression would be authorizing
work outside this ticket's scope (the same concern "An Approval Authorizes
Only Its Ticket's Work" exists to prevent).

Sent as a `note` (priority 50, non-blocking) to specifier and coordinator,
for the specifier to judge whether it warrants a follow-up ticket.

By architect.
