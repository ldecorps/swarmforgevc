# Outage-driven seat failover via Model Steward (BL-669)

When a provider outage record (BL-840's producer, promoted automatically for
unambiguous exhaustion since BL-1335 — see below) stays open long enough, the
coordinator can consult the Model Steward for a **certified** substitute and
apply it to an affected seat at the next **idle** boundary — then auto-revert
when the outage `endedAtUtc` closes.

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

## Load-file safety (BL-1150)

`handoffd.bb` `(load-file …/outage_failover_cli.bb)`. A bare `(-main)` at
the bottom of the CLI printed usage and called `System/exit 1`, so a restored
handoffd could not start. The CLI now guards `-main` the same way as
`post_hotfix_merge_origin.bb`:

```clojure
(when (= *file* (System/getProperty "babashka.file"))
  (-main))
```

`load-file` therefore defines the namespace and returns; running
`bb outage_failover_cli.bb …` still reaches `-main`. Regression:

```bash
bb swarmforge/scripts/test/test_outage_failover_cli_load_file_safe.bb
```

Hotfix `ca45facb4` (same guard + failover sweep defined after
`role-mailbox-idle?`) is the ops land this ticket certifies through the
pipeline; ledger stamp-off still waits on a human Approvals decision
([BL-848](BL-848-certify-an-operator-hotfix.md)).

## Automated promotion (BL-1335)

`provider-outages.jsonl` — the file this ticket's consumer reads — used to
gain a record only when a human typed one by hand. BL-840's producer
(`record-provider-outage!`) and this ticket's consumer read *different*
files, and nothing bridged them.

`exhaustion_failover_promotion_lib.bb` is that bridge. `handoffd.bb` calls
`promote-exhaustion-to-failover!` from the live tick, inside the same
`observe-pane-provider-outage!` pane snapshot that already produces BL-840's
evidence — no second capture, no separate scanner. `classify-evidence` gives
each evidence line one of three answers, per the human's ruling ("promote
automatically only when the classification is unambiguous, otherwise
announce for operator confirmation"):

| classification | what happens |
| --- | --- |
| unambiguous period/quota exhaustion | a failover record opens automatically |
| suspected (rate limit, 429, "usage limit") | announced only — operator confirms |
| anything else, including unrecognised text | nothing (fails closed) |

The record is written in `provider_outage_record_lib`'s own
`normalize-record` shape, so this consumer needs no change to read it.
Idempotent per open incident: a still-open record for the same
seat/provider/model suppresses a repeat promotion; a closed record, a
different model, or a different seat does not.

Closing a record when the period resets is not yet automated — BL-669's own
auto-revert only fires once a record's `endedAtUtc` is set, and nothing here
sets it. Until a future ticket closes that gap, an exhaustion record opened
automatically still needs a human (or a future automation) to close it on
reset.

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
- Provider outage records (BL-840 producer) — `provider-outages.jsonl`,
  automatically promoted from evidence since BL-1335
- Acceptance: `specs/features/BL-669-outage-driven-seat-failover-via-steward.feature`
- Acceptance (promotion): `specs/features/BL-1335-token-exhaustion-opens-an-outage-record.feature`
