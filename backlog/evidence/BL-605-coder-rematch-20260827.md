# BL-605 — coder rematch — QA bounce 20260827

## Bounce

QA `450d687968`: `extension/test/globalTokenConsumption.test.js` imported
`node:test`, so Vitest reported "No test suite found" (exit 1).

## Rematch

Dropped `const { test } = require('node:test')` so the file uses Vitest's
global `test` (same pattern as `burnRate.test.js`).

```
npx vitest run test/globalTokenConsumption.test.js  # 7/7
npx vitest run --config vitest.properties.config.mjs \
  test/globalTokenConsumption.property.test.js       # 3/3
```

Also re-landed tip-pure `f2a5c9168d` on this seat (was missing after merge).

By coder.
