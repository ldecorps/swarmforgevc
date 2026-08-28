# `/redeploy frontdesk` and `/redeploy all` are reachable (BL-1204)

*How-to. Task-oriented: confirm the two Telegram redeploy targets dispatch
to their real modules, and how the acceptance step handler's own fixture
lifecycle was hardened along the way.*

## What was dark

`extension/src/tools/telegramCursorBridgeFrontDeskRedeploy.ts` and
`telegramCursorBridgeAllRedeploy.ts` existed, were unit-tested, and were
green — but nothing in `extension/src` imported either module.
`executeOperatorVerb`'s `/redeploy` branch only special-cased `"mini"` in
its args and otherwise fell straight through to the plain cursor-bridge
redeploy, silently bouncing the wrong runtime while reporting success. The
one test that would have caught it — `telegramCursorBridgeCore.test.js`'s
help-text assertions for both lines — was already red, and read as
background noise in a suite already carrying other reds (the BL-419
shape: a mechanism built, unit-tested, green, wired into none of the
places it was built for).

## What's fixed

`telegramCursorOperatorExec.ts` now dispatches `/redeploy frontdesk` and
`/redeploy all` via each module's own real parser
(`parseFrontDeskRedeployCommand` / `parseAllRedeployCommand`) against the
reconstructed full command text, so dispatch can never drift from each
module's own accepted-variant set. `telegramCursorBridgeCore.ts`'s
`formatHelpMessage` lists both forms (see the `/redeploy` block in
[BL-698 operator commands](BL-698-telegram-cursor-operator-commands.md)).
A parity invariant is encoded as an executable test — every redeploy
target the bridge accepts is listed in help, and every listed target is
accepted — derived from each module's real parser, never a second
hand-typed string list.

`/redeploy` and `/redeploy miniapp` are unchanged.

## Acceptance step handler hardening (fixture-leak class)

The acceptance step file for this feature
(`specs/pipeline/steps/bl1204RedeployTargetsReachableAndListedSteps.js`)
went through three architect bounce rounds fixing shape-of-defect, not
production code:

1. A missing acceptance step handler (architect bounce 1).
2. The acceptance step racing the async redeploy dispatch (architect
   bounce 2, part 1).
3. The shared `Background` leaking a fixture root unconditionally,
   including on the help-message scenario that never uses one (architect
   bounce 2, part 2) — fixed by moving `mkFixtureRoot()` out of
   `Background` into the redeploy-target Outline's own first step.

A subsequent hardener pass found two more instances of the same
throw-before-cleanup leak shape in that file, both hand-verified as real
(not theoretical) via mutation:

- The terminal step's cleanup only ran after every assertion passed —
  fixed by wrapping the assertions in `try { ... } finally { ... }`.
- The first step could itself throw (an out-of-range redeploy target)
  with nothing downstream to catch it — fixed by wrapping its body in
  `try { ... } catch (err) { cleanup(); throw err; }`.

Final BL-113 Gherkin mutation run on the feature: 3/3 killed, 0 survived,
0 leaked fixture directories.

## Where it lives

| Piece | Location |
| --- | --- |
| Dispatch wiring | `extension/src/tools/telegramCursorOperatorExec.ts` |
| Help text | `extension/src/tools/telegramCursorBridgeCore.ts` (`formatHelpMessage`) |
| Target modules | `extension/src/tools/telegramCursorBridgeFrontDeskRedeploy.ts`, `telegramCursorBridgeAllRedeploy.ts` |
| Acceptance feature | `specs/features/BL-1204-redeploy-targets-are-reachable-and-listed.feature` |
| Acceptance steps | `specs/pipeline/steps/bl1204RedeployTargetsReachableAndListedSteps.js` |

## Related

- [BL-698 operator commands](BL-698-telegram-cursor-operator-commands.md) — the full redeploy-form table this ticket restored two rows of.
- [BL-710 Specification.MD entry](../reference/Specification.MD) — documented the intended `/redeploy` verb family this fix brings the implementation back into agreement with.

## Verify

```bash
npm run compile
npx vitest run test/telegramCursorBridgeCore.test.js test/telegramCursorOperatorExec.test.js test/telegramCursorBridgeRedeployTargets.test.js
node specs/pipeline/cli.js specs/features/BL-1204-redeploy-targets-are-reachable-and-listed.feature
```

Acceptance: `specs/features/BL-1204-redeploy-targets-are-reachable-and-listed.feature`
