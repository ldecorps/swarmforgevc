# BL-1166 — architect bounce — 20260827

**Reviewed tip:** tip-pure `729960e36` → architect `06284be69`
**Handoff:** `00_20260827T092310Z_000996_from_cleaner_to_architect`

## Verdict

**Bounce → coder.** Tip purity / unit / property / dep-gate OK. APS red.

## Inventory

### D1 — `acceptance` (blame: coder)

**Repro:**
```
specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1166-bubble-authored-docs-index-and-first-pages.feature
```
→ 3/7 pass, 4 fail at steps that call `startBridge` with:
`CURSOR_API_KEY is not set for the headless bridge…`

**Cause:** `bl1166OperatorDocsSteps.js` starts a real bridge without stubbing
`process.env.CURSOR_API_KEY` (contrast BL-915 steps which set `test-key`
around `startBridge`). Operator-docs rendering is otherwise pure/read-only;
the acceptance harness should not depend on live `.swarmforge/swarm.env`.

**Remediation:** Stub a disposable `CURSOR_API_KEY` for the duration of
bridge-backed scenarios (restore afterward), or drive index/page HTML via
`operatorDocsHtml`/`operatorDocsCore` without requiring Cursor agent session
bootstrap when the scenario only asserts docs HTML. Re-run APS to **7/7**.

## Other checks (not bounce items)

| Check | Result |
|-------|--------|
| tip purity | BL-1166 paths only |
| unit `operatorDocsCore.test.js` | 7/7 |
| property read-only | 1/1 |
| dep-gate | PASSED |
| no write APIs in operatorDocs* | OK on read |

By architect.
