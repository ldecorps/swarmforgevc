# Adjudication: unowned red, stepHandlerModuleLoadBudget names bl1050 under the full suite - 2026-09-21 (specifier)

**Inbound.** Coder note to the specifier and the coordinator, priority 00,
2026-09-21T09:23:44Z (00_20260921T092344Z_002085_from_coder), verbatim:
"unowned-red: stepHandlerModuleLoadBudget bl1050 fails full-suite, clean
alone". No evidence file accompanied it (the coder holds BL-1638 and
reported in passing); the failing line's shape is the guard's own:
`module-load budget violation(s): bl1050CursorRunFailureLogSteps.js:
incremental require cost <N> ms exceeds the 400ms budget (confirmed
alone)`. The coder's exact N is theirs to append to this file.

**Mechanism (verified).** `extension/test/stepHandlerModuleLoadBudget.test.js`
(BL-1630, landed 2026-09-21) runs the require census over every step
handler with a 400 ms per-handler budget and clears a pole by a
best-of-three fresh-child re-measurement (BL-1633's confirm-alone). Its
comment block records the 2026-09-20 ruling that
`bl1050CursorRunFailureLogSteps.js` is NOT allowlisted ("timing variance"
is not an accepted reason) because that re-measurement clears "a
genuinely heavy, BL-968-compliant production-code require, 137-180 ms
when confirmed alone". Under the full unit suite the three samples run
concurrently with the suite's other forks and all three exceed 400 ms.
Specifier measurement on the master checkout at load 3.4:

```
node -e "const c=require('./test/helpers/stepHandlerRequireCensus'); ..."   (from extension/)
bl1050CursorRunFailureLogSteps.js 201/204/174 ms
bl1049CursorBridgeRunSteps.js       0/0/0 ms
bl1002ExampleSteps.js               0/0/0 ms
```

The cost is the handler's own module-scope requires (lines 29-30:
`extension/out/bridge/cursorBridgeAgentSession`, `cursorBridgeRunLog`;
the session module pulls `@cursor/sdk`, `telegramCursorBridgeCore`,
`letsTalkCore`, `swarmEnv`, `cursorBridgeProgress`), not the host.

**Ruling.**

1. The red is real on main (the guard file is on main; the coder saw it
   with main merged) and is `type: defect`, `severity: high` at first
   sighting per the 2026-09-05 rule. Its owner is **BL-1658** (paused,
   approved), re-classed from medium to high: the durable fix is the
   very shape BL-1658 applies to seven jsdom handlers - the heavy require
   moves inside the step that needs it - so bl1050 joins that population
   (title, invariant, amendment section, feature outline row, scenario
   02's "none of the eight"). No allowlist entry: the 2026-09-20 ruling
   stands. Folded rather than minted apart (one guard, one census, one
   fix shape; human directive 2026-09-17).
2. Register row added:
   `unit  extension/test/stepHandlerModuleLoadBudget.test.js  BL-1658  2026-09-21`;
   it leaves in BL-1658's land (BL-1631). BL-1658 depends on BL-1630
   (landed), so it is promotable now and expedited as high.
3. Interim for every role: a full-lane red on this file that names ONLY
   bl1050 is this owned red - one run, record the line, do not bounce a
   parcel that touches neither bl1050 nor the guard (QA.prompt rule of
   2026-09-20); a solo run of the guard file confirms the class.
4. Observation for the guard's future (not ticketed): confirm-alone
   inside a loaded suite is not alone. If a second heavy production
   require shows the same shape after BL-1658, the guard's
   re-measurement should run with the suite's other forks quiesced or
   be budgeted against a solo baseline (BL-1633's solo-vs-in-suite rule
   for duration budgets). Recorded here so the next sighting is not
   re-derived.

**Notes sent this pass.** Coder (holder of BL-1638, the reporter): the
red's owner and commit. Coordinator: BL-1658 re-classed high and
promotable.

By specifier.
