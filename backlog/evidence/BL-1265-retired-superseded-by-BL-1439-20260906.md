# BL-1265: retired — superseded by BL-1439 (specifier, 2026-09-06)

Trigger: coder `note`, priority 00, 2026-09-06T19:38:02Z: "BL-1265 moot:
guard already green (BL-1439 landed the 4 deps); retire?". The coder had
the coordinator's Work note for BL-1265 and forwarded nothing (No-Op Rule).

## Premise re-verified on main (0ddebf8da9.. at 19:4xZ)

- `cd extension && npx vitest run test/operatorRuntimeBbFixtureClosure.test.js`:
  1 file, 6 tests passed (the two BL-1265 named as failing at mint - the
  break-then-fix test and the closure-honesty check - among them).
- `specs/pipeline/steps/lib/operatorRuntimeBbFixtureFiles.js` names all
  four: context_telemetry_store.bb, role_ask_escalation_lib.bb,
  rotation_telemetry_lib.bb, self_heal_telemetry_lib.bb (grep count 1 each).
- `git log -S'self_heal_telemetry_lib.bb' -- <that file>`: added by
  ed6fb8892b, "BL-1439: the deferred hardening gates of 08-19 are run and
  discharged" (2026-09-06). BL-1439's coder evidence (BL-1439-coder-20260905.md
  §"fixed in this parcel"): the list had drifted five more entries behind
  the closure; fixed directly as a mechanical, in-scope-adjacent list
  addition; cleaner and architect evidence both verify it.

BL-1265's invariant ("the declared list equals the real transitive closure
exactly") holds on main; its constraints (no DECLARED_EXTRAS shortcut, no
guard weakening, no walk change, no .bb edits) were respected by BL-1439's
fix. Nothing remains to build.

## Retirement

- Ticket: `status: superseded`, `closed_as: superseded-by-BL-1439`,
  `milestone: M8` added (close_ticket.sh refuses a ticket without one);
  moved active -> done/M8 by `close_ticket.sh` (BL-1363).
- Feature `specs/features/BL-1265-the-declared-closure-matches-the-real-one.feature`
  (three scenarios, never given a step handler) deleted and registered:
  `retirement_registry_cli.bb . register BL-1265 <path>` (BL-1258), so a
  branch still carrying it cannot restore it through a merge.
- Superseded marker written at
  `.swarmforge/superseded/BL-1265-operator-runtime-closure-list-drifted-again-four-undeclared-deps`
  (BL-1084) so any stray parcel for the task is refused at turn start.
- Adjudication recorded: `record-adjudication.js . BL-1265 retire specifier`.
- The pattern - the eighth hand-fix of the same list (BL-944 counted five
  before a sixth; BL-1265 was the seventh; BL-1439's collateral fix the
  eighth) - is BL-1449, minted the same pass: the list is derived at load
  from the walk BL-944 already has, never typed.
