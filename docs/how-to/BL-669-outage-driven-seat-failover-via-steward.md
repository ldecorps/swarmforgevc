# Outage-driven seat failover via Model Steward (BL-669)

When a provider outage record (BL-650) stays open long enough, the coordinator
can consult the Model Steward for a **certified** substitute and apply it to
an affected seat at the next **idle** boundary — then auto-revert when the
outage `endedAtUtc` closes.

## What changed

| Piece | Role |
| --- | --- |
| `outage_failover_lib.bb` | Pure decisions: sustained threshold, steward consult, mid-turn defer, attended propose vs unattended auto-apply |
| `outage_failover_cli.bb` | Evaluate / apply-if-idle / register-opus-fallback; coordinator sweep entry |
| `outage_failover_store.bb` | Active-swap state, operator announcements, COST experiment log |
| `handoffd.bb` | `outage-driven-seat-failover-sweep!` on flow-watchdog cadence |
| `models.seed.json` | `anthropic/claude-opus-4-8` certified same-provider architect fallback |

Invariants: only `assignment-eligible?` substitutes (no `--override-uncertified`);
never apply mid-turn; every swap/revert announced + logged.

## Operator notes

**Evaluate** what the sweep would do for a seat:

```bash
bb swarmforge/scripts/outage_failover_cli.bb evaluate --seat architect
```

**Attended vs unattended:** set `OUTAGE_FAILOVER_ATTENDED=1` for propose-only
(operator confirms); default unattended path auto-applies at idle.

**Register the opus-4-8 fallback row** (first-time steward seed on a fresh host):

```bash
bb swarmforge/scripts/outage_failover_cli.bb register-opus-fallback
```

**Verify:**

```bash
bb swarmforge/scripts/test/outage_failover_test_runner.bb
node --test extension/test/bl669OutageFailoverSteward.property.test.js
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-669-outage-driven-seat-failover-via-steward.feature
```

## Related

- [Model Steward overview (BL-547)](BL-547-model-steward-overview.md)
- Provider outage records (BL-650) — `provider-outages.jsonl`
- Acceptance: `specs/features/BL-669-outage-driven-seat-failover-via-steward.feature`
