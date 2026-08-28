# Active-pool freshness/hold divergence audit (BL-1228)

*How-to. Task-oriented: surface any ticket already sitting in
`backlog/active/` whose own deprecator freshness check (Article 3.6) does
not currently say `allow`.*

The promote-time gate ([BL-1173](BL-1173-deprecator-freshness-gate-cli.md))
stops a `hold` ticket from moving `paused/` → `active/` — but only when the
move goes through `promote_and_route_next.sh`. Nothing previously compared
a ticket already sitting in `active/` against what its own freshness check
still says, so a hand-rolled promotion (e.g. a manual `git mv`) could walk
past the gate unnoticed. `main` commit `cac8afef8` (2026-08-28) is the
incident this audit backstops.

## What it does

For every `backlog/active/*.yaml` ticket, the audit calls the same
`deprecate-check.js` CLI the promote gate uses and reports any ticket whose
verdict is not exactly `allow`. It is **report-only**: it never moves,
creates, deletes, or rewrites a backlog file. Article 3.6 adjudication
(amend / retire / split / confirm) stays with the specifier.

Fails closed on every unreadable verdict — missing CLI, non-zero exit,
unparseable JSON, or an unrecognised decision shape is reported as a hold,
never treated as clear.

## CLI

```bash
node extension/out/tools/active-pool-freshness-audit.js <project-root>
```

or, preferred, the wrapper that resolves the compiled CLI itself and no-ops
cleanly (exit 0, one stderr line) if the extension hasn't been compiled:

```bash
swarmforge/scripts/active_pool_freshness_audit.sh [project-root]
```

Output is one line per finding:

```
ACTIVE-POOL-FRESHNESS-HOLD <ticket-id>  <path>  (<reason>)
```

or, when every active ticket allows:

```
active_pool_freshness_audit: clean — every backlog/active/ ticket allows
```

## Wired call site

`swarmforge/scripts/promote_and_route_next.sh` runs the audit at the end of
a successful promotion, so every legitimate promotion surfaces any ticket
that got into `active/` by another path. This is the promotion-time call
the human ruled on at mint — a periodic/daemon sweep of the pool
independent of promotions was considered and deferred, not overlooked (see
the ticket's `approval_context`): a pool that goes quiet between promotions
stays unaudited until the next one.

## Modules

| Piece | Location |
| --- | --- |
| Pure audit + thin CLI | `extension/src/tools/active-pool-freshness-audit.ts` |
| Shell wrapper | `swarmforge/scripts/active_pool_freshness_audit.sh` |
| Promotion call site | `swarmforge/scripts/promote_and_route_next.sh` |
| Verdict source (unchanged by this ticket) | `extension/src/tools/deprecate-check.ts` |
| Constitution | Article 3.6 — `03_backlog.md` / `03-backlog-detailed.md` |

## Verify

```bash
cd extension && npm test -- activePoolFreshnessAudit
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1228-active-pool-freshness-hold-divergence-audit.feature
```

Acceptance:
`specs/features/BL-1228-active-pool-freshness-hold-divergence-audit.feature`

Related: promote-time gate
[BL-1173](BL-1173-deprecator-freshness-gate-cli.md); verdict precision
(retired-token extractor, supersede-claim branch) is separate slice
BL-1193, out of scope here.
