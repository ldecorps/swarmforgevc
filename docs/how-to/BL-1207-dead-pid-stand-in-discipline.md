# Picking a dead-pid stand-in for a liveness test (BL-1207)

*How-to. Task-oriented: pick a "this process cannot be alive" pid for a
test without hard-coding an unrelated environment fact.*

## The trap

`extension/test/cursorBridgeAgentSession.test.js`'s malformed-lock table
used to carry `'  42  \n'` as a case expected to be rejected as an invalid
pid. It is not invalid: `readLockHolderPid` trims before parsing, so a
padded pid is well-formed, and `isAbandonedAgentLock` falls through to the
liveness check instead. On a systemd host, pid 42 is a live, root-owned
`systemd-journal` process — `process.kill(42, 0)` raises `EPERM`, which
`isProcessAlive` correctly reads as **alive** (it may exist but be
unsignalable). The test's verdict was decided by whether that pid happened
to be running on the host under test, not by the rejection behaviour it
was filed under: red on a systemd host, green elsewhere, for a reason
unrelated to what the assertion claimed to check. Production
(`extension/src/bridge/cursorBridgeAgentSession.ts`) was correct on both
counts — trimming before parsing, and reading `EPERM` as alive — the
defect was entirely a test case filed under the wrong assertion.

## The fix, as a reusable pattern

1. **A malformed value and a well-formed-but-dead value are different
   scenarios.** A padded pid parses to a positive integer — that is
   well-formed, never a malformed case. Keep the two tables/scenarios
   disjoint and jointly total: a case moved out of "malformed" must land
   in a liveness scenario, never dropped, or the trim branch loses
   coverage silently.
2. **A dead-process stand-in comes from a declared, commented constant —
   never a small literal a real system process could plausibly hold.**
   `DEAD_PID = 99000001`, matching
   `test/bl984FixtureSweep.property.test.js`'s `DEAD_PID_BASE` reasoning:
   far beyond any real pid table (macOS `pid_max` ~99998, Linux ~4M
   default), so `process.kill(pid, 0)` on it raises `ESRCH`/`ERANGE`,
   never `EPERM`. The mirror-image pattern for an always-alive stand-in is
   `test/telegramCursorBridgeRedeploy.test.js`'s use of pid 1.
3. **Assert the stand-in's own unreachability on the host running the
   suite**, don't just assume it — a scenario that signals the declared
   dead pid and asserts the raised code is `ESRCH`/`ERANGE` (never `EPERM`,
   never success) is what stops the constant from quietly becoming a real
   process the way `42` did.
4. **Guard the class against regenerating, keyed on the structured case
   list, never a prose grep.** A scenario asserting that no remaining
   malformed case parses to a positive integer after trimming catches this
   at authoring time — and it must read the same list the verdict test
   iterates, because the test file, its feature file, and this ticket all
   legitimately quote the offending value in prose while explaining it; a
   text search over those would trip on its own explanation.

## Where it lives

| Piece | Location |
| --- | --- |
| Malformed-case table (disjoint from liveness) | `MALFORMED_LOCK_CASES` in `extension/test/cursorBridgeAgentSession.test.js` |
| Declared dead-pid constant | `DEAD_PID = 99000001`, same file |
| Liveness-alone scenario (padded pid) | `isAbandonedAgentLock judges a padded pid by liveness alone, not by its padding` |
| On-host unreachability assertion | `the declared unreachable pid is actually unreachable on this host` |
| Non-vacuity / no-regeneration guard | `no malformed case parses to a positive integer` |
| Sibling precedents (unmodified by this ticket) | `test/bl984FixtureSweep.property.test.js` (`DEAD_PID_BASE`), `test/telegramCursorBridgeRedeploy.test.js` (pid 1 for the always-alive/EPERM branch) |

## Human-facing surface

None. `readLockHolderPid`'s trim and `isProcessAlive`'s `EPERM`-means-alive
reading are both correct and unchanged — this is a test-file-only fix with
no new command, setting, or production behaviour.

## Verify

```bash
cd extension && npx vitest run test/cursorBridgeAgentSession.test.js
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1207-abandoned-lock-verdict-is-host-independent.feature
```

Acceptance: `specs/features/BL-1207-abandoned-lock-verdict-is-host-independent.feature`
