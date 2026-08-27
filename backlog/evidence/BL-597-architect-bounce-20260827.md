# BL-597 — architect bounce — 20260827

## Review inventory (Article 4.4)

### D1 — invariant-unencoded (coder)

Ticket declares three `invariants:`; parcel `ce0a144ea9` carries **no**
`*.property.test.js` encoding any of them, and no stated non-encodability
reason (BL-633 / BL-654).

| # | invariant | encoding found |
|---|---|---|
| 1 | Emit only at existing prose log sites — no parallel detection path | none |
| 2 | Failed telemetry append must not change whether self-heal runs | acceptance scenario only; no property |
| 3 | Raw events in append-only gitignored `.swarmforge/telemetry/self-heal-*.jsonl` | unit/acceptance only; no property |

Vacuous or example-only coverage does not satisfy the coder property-test
obligation. Architect does not author the missing property tests.

## Inbound

Cleaner `566c122982` (tip polluted with BL-600 + hitchhikers). Reviewed tip-pure
coder `ce0a144ea9` (cleaner evidence: cherry-pick of that tip).

## Architecture (informational — not the bounce)

Tip-pure wiring respects metrics/telemetry boundary; dep-gate would be
expected to pass on `selfHealTelemetry*.ts`. Not forwarded.

## Remediation

Coder: add executable property tests (or documented non-encodability) for
**all three** declared invariants in the same parcel; re-handoff via cleaner.

## Commit reviewed

`ce0a144ea9`

By architect.
