# Unowned red: bl956PipelineBoardCaptionCapInvariants, QA, 2026-09-21

During BL-1467's `npm run test:properties` full-lane run,
`test/bl956PipelineBoardCaptionCapInvariants.property.test.js` failed once:

```
AssertionError (from fast-check property, invariant at line 77)
Serialized Error: { generatedMessage: false, code: 'ERR_ASSERTION' }
```

The file is not in BL-1467's diff (BL-1467 touches only
`swarmforge/scripts/land_main_publish.sh`, `land_step_cli.bb`,
`land_step_lib.bb`, its own test runner, and its own new
feature/handler/property files). Re-run standalone immediately after:
`npx vitest run --config vitest.properties.config.mjs test/bl956PipelineBoardCaptionCapInvariants.property.test.js`
- 3/3 pass, clean.

Grepped first: no open ticket names `bl956PipelineBoardCaptionCapInvariants`
or a standing-red register row for it.

Per the 2026-09-20 closing-ceremony rule (QA.prompt), this is reported as a
single sighting, not re-run as a full-lane "confirm the flake" loop.
BL-1467's own review proceeds on its own merits, unaffected.

By QA.
