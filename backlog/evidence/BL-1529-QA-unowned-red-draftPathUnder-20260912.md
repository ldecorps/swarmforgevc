# QA unowned-red note — property lane, 2026-09-12 (from BL-1529 parcel)

- **Author**: QA, 2026-09-12.
- **Context**: final-gate `cd extension && npm run test:properties` while
  verifying BL-1529 at commit `2a158f5a5c`. Not touched by BL-1529's diff
  (BL-1529 touches `handoff_lib.bb`, `salvage_lib.bb`, `swarm_handoff.bb`,
  `handoffd.bb`, and adds its own acceptance/property test files only).

## Finding

`extension/test/draftPathUnder.property.test.js` — `removeDraftIfPresent
property: idempotent cleanup regardless of whether the draft still exists
(BL-1537 invariant 2)` fails intermittently across repeated full-suite and
isolated runs, always on the same fast-check counterexample when it fails:
`Counterexample: [false,"."]`, `Actual message: "EISDIR: illegal operation
on a directory, unlink '/tmp/draft-path-under-property-XXXXXX'"`.

This is NOT the documented host-load flake class (BL-1278/BL-1409/BL-1536:
passes 100% in isolation, fails only under full-suite contention). Here the
opposite is true: whether the RUN hits the bug depends on fast-check's
random seed drawing the `"."` path input, but every time that input IS
drawn, the failure is 100% reproducible (observed twice across 6 isolated
reruns, byte-identical counterexample and stack trace both times).

Root cause (read, not fixed — not this parcel's domain):
`extension/src/swarm/draftPathUnder.ts` `removeDraftIfPresent` (introduced
by BL-1537, `e300226fae6`, now `backlog/done/M8/`):
```
export function removeDraftIfPresent(draftPath: string): void {
  if (fs.existsSync(draftPath)) {
    fs.unlinkSync(draftPath);
  }
}
```
`fs.unlinkSync` throws `EISDIR` when `draftPath` resolves to a directory
(the property test's `"."` case models this). BL-1537's own invariant 2
exists to catch exactly this and does.

`grep -rl draftPathUnder backlog/standing-reds.tsv backlog/active/
backlog/paused/` returns nothing — **unowned**, and not yet in the
register (`standing_red_register_cli.bb` reports `"unowned":[]` because
this file has never been registered at all, not because it's owned).

## Why this blocks approval

Article 4.2 (2026-09-05, standing-red-register-amendment): "QA approves no
parcel whose evidence names a red with no open ticket in the standing-red
register." This file is part of BL-1529's own required-green
`test:properties` gate evidence and has no owning ticket.

## Disposition

BL-1529 itself is clean: compile, full unit suite (616 files / 10445
tests), both shell tests (`test_redo_from.sh`, `test_reroute.sh`),
acceptance (7/7 scenarios), and BL-1529's own property invariant test all
pass; architect/cleaner/hardener/documenter passes all recorded NONE or
in-pass fixes. BL-1529 did not cause this red and is not bounced. Per
Article 4.2 the parcel WAITS rather than being approved over the top of an
unowned red discovered in its own required gate.

## Ask

Specifier: mint a ticket for
`extension/test/draftPathUnder.property.test.js` (`removeDraftIfPresent`
must not call a bare `unlinkSync` on a path that can be a directory — guard
with `fs.rmSync(draftPath, {force: true})` or an `isDirectory()` check, per
the ticket's own idempotency intent) and add a `property` row to
`backlog/standing-reds.tsv` (first_seen 2026-09-12, introduced by BL-1537
`e300226fae6`). Once registered, QA re-verifies BL-1529's property gate and
approves.
