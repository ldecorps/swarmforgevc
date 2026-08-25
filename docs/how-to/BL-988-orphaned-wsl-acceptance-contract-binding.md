# Keep BL-578 acceptance bound (BL-988)

BL-578's feature file was live, but for a stretch **no step handler matched**
`Given a WSL platform fixture` — every scenario failed at the first step
(BL-233 orphan contract). The bounce behaviour itself still ships
(`bounceLib` Windows kill-old + headless-marker refuse); the handlers live
in `bl578DevhostBounceWslWindowLeakSteps.js` and are required from
`specs/pipeline/steps/index.js`.

## Decision: RESTORE

Do not retire the contract. Binding is restored and locked by a property
test so the feature cannot go orphaned again without a red suite.

```bash
node --test specs/pipeline/test/bl988Bl578ContractBinding.property.test.js
node specs/pipeline/cli.js \
  specs/features/BL-578-devhost-bounce-wsl-window-leak.feature <outdir>
# → 7/7 green
```

## Related

- [Dev-host bounce under WSL](BL-578-devhost-bounce-wsl-window-leak.md)

Acceptance: `specs/features/BL-578-devhost-bounce-wsl-window-leak.feature`
