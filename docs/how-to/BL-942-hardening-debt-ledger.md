# The hardening-debt ledger (BL-942)

## Background

`hardender.prompt`'s office-hours mutation/CRAP bypass (operator policy,
2026-07-06) lets a hardening pass defer a heavy Stryker/CRAP run on a busy
host, on the promise that "the full pass still runs — just against a quiet
host, not a contended daytime one." That promise had no second half: nothing
recorded what was skipped, and nothing brought it back. Measured 2026-08-19:
35 of 60 August hardener evidence files recorded a deferral, only 2 recorded
a gate actually running — and since continuous 3x8 shifts armed
2026-08-18, the quiet host the bypass waits on cannot arrive at all (eight
agent sessions run around the clock on 4 cores; the busy threshold is a load
average of 8, and the host never drops below it).

BL-942 builds the **recording** half only — not the drain. Which remedy
closes the debt (a reserved quiet window, rescoping Stryker to run under
load, or formally downgrading the gate) is a live human decision
(`approval_context` on the ticket); this ledger is what makes that decision
answerable with evidence instead of impressions.

Follows `backlog/hotfix-ledger.yaml`'s own shape
(`docs/how-to/BL-848-certify-an-operator-hotfix.md`) rather than inventing a
new storage idiom: a flat list of scalar-field rows, hand-parsed line by
line.

## Recording a deferral

When a hardening pass takes the office-hours bypass and defers a mutation or
CRAP gate, run:

```bash
swarmforge/scripts/hardening_debt_ledger_update.bb <project-root> --defer \
  <parcel> <gate> <file-set-csv> <reason> <load> [<detected-at>]
```

- `<parcel>` — the ticket id the deferring pass belongs to.
- `<gate>` — which gate was skipped (e.g. `mutation`, `crap`).
- `<file-set-csv>` — the exact files the gate would have covered, comma-joined.
- `<reason>` — free text (e.g. `blocked by the "quiet host" promise` — quotes
  are escaped safely on write and read back exactly).
- `<load>` — the measurement that justified the skip (e.g. an `uptime`
  reading), recorded verbatim, not re-derived later.
- `<detected-at>` — optional, defaults to today (`YYYY-MM-DD`).

This is **the one mechanical way** a deferral gets recorded — it never
decides *whether* to defer; that judgement stays `hardender.prompt`'s own.
As of this ticket, no call site is wired into the hardener's live workflow
yet: a hardening pass that takes the bypass must call this by hand.

A second deferral for the same `<gate>` + `<file-set-csv>` — even from a
different parcel — collapses to the existing row rather than duplicating it
(`debt-key`, keyed on gate+file-set, not parcel). A gate that **ran**
records nothing; a ledger that fills up on successes tells the operator
nothing.

## Reading outstanding debt

```bash
swarmforge/scripts/hardening_debt_ledger_read.bb <project-root> [--parcel <id>]
```

Prints a JSON array of `{parcel, gate, file_set, reason, load, detected_at}`
— `file_set` is a real JSON array, never the on-disk comma-joined string, so
a caller never re-parses the ledger's own storage shape. `--parcel <id>`
narrows to rows for one ticket. Read-only: this CLI never mutates
`backlog/hardening-debt-ledger.yaml`.

## Where it lives

```
backlog/hardening-debt-ledger.yaml    the ledger itself (seeded empty; the
                                       35 August deferrals were not backfilled)
```

The historical rows are recoverable from `backlog/evidence/` later if
anyone wants them — mining them was explicitly out of this ticket's scope;
what makes the gate enforceable is recording forward from here.

## Verify

```bash
bb swarmforge/scripts/test/hardening_debt_ledger_lib_test_runner.bb
bb swarmforge/scripts/test/bl942_hardening_debt_ledger_property_runner.bb
bash swarmforge/scripts/test/test_hardening_debt_ledger_cli.sh
```

Acceptance feature:
[`specs/features/BL-942-deferred-hardening-debt-is-durable.feature`](../../specs/features/BL-942-deferred-hardening-debt-is-durable.feature).

## See also

- **BL-941** — discharges one specific instance of this debt (BL-915's), the
  case that surfaced this gap.
- **BL-472** (deferred) — wires mutation/CRAP tooling for Babashka itself, a
  different gap: that one is a tool that does not exist; this one is a tool
  that exists and never gets to run.
- `docs/how-to/BL-848-certify-an-operator-hotfix.md` — the sibling ledger
  this one's storage shape follows.
