# BL-597 — coder rematch — declared invariant property tests — 20260827

Architect bounce D1: three invariants unencoded on tip `ce0a144ea9`.

## Remediation

Tip-pure line `tmp-bl597-tip-pure` on `origin/main` + cherry-pick
`ce0a144ea9` + `extension/test/selfHealTelemetry.property.test.js` encoding
all three declared invariants (non-vacuous aggregator check included).

## Verification

| check | result |
|---|---|
| `selfHealTelemetry.property.test.js` | 7/7 |
| `selfHealTelemetry.test.js` | 2/2 |
| acceptance BL-597 | 8/8 |
| `git diff --name-only origin/main...HEAD` | BL-597-only |

By coder.
