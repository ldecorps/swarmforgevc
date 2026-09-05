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

## Discharging a deferral (BL-1439)

A deferred gate that later actually ran is recorded with the ledger's
second verb, `--discharge`:

```bash
swarmforge/scripts/hardening_debt_ledger_update.bb <project-root> --discharge \
  <parcel> <gate> --evidence <path> [<discharged-at>]
```

This is the rule the ledger was missing at BL-942's own mint: **a run
discharges what a deferral recorded.** It matches the outstanding row by
`(parcel, gate)` — the same identity `--defer` keys on — and sets
`discharged_at`/`discharged_evidence`; it never deletes the row, so the
deferral and its discharge stay readable together (invariant: never
deleted, only marked). It refuses (exits 1, writes nothing) with no
`--evidence` path or no matching outstanding row — never a silent no-op
that would leave debt looking paid when nothing was actually recorded.
`outstanding-debt` (the one filter both `hardening_debt_ledger_read.bb`
and the standing-red register CLI read) excludes a discharged row; the
register row for that gate leaves the register in the same commit that
records the discharge.

**A run the host refused is an attempt, not a discharge** (amendment
2026-09-06, BL-1439): the third verb, `--attempt`, records a blocker on
the row without paying the debt —

```bash
swarmforge/scripts/hardening_debt_ledger_update.bb <project-root> --attempt \
  <parcel> <gate> <blocker> [<attempted-at>]
```

sets `attempted_at`/`attempted_blocker` (free text, e.g. the mutation
cooldown window or a suite-wide red blocking the dry run) but never
`discharged_at` — `outstanding-debt` still reports the row, because an
attempt is evidence a real try happened, not proof the gate ran
(invariant carried from the original ticket: a gate that cannot complete
on this host is recorded as such and stays outstanding, never discharged
by assertion). An attempted-but-still-outstanding row keeps its register
row, re-pointed to whichever ticket now owns finishing the run, so the
debt never reads unowned while it waits.

`hardening_debt_ledger_read.bb`'s JSON gains `discharged_at`,
`discharged_evidence`, `attempted_at`, and `attempted_blocker` (each
`null` until set).

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
- **BL-1439** — the ledger's `--discharge` and `--attempt` verbs (above);
  discharged the 2026-08-19 deferrals it could run, recorded the rest as
  attempts, and re-pointed their register rows to **BL-1441**, which owns
  actually running the four still-blocked gates once the mutation cooldown
  and BL-1440's citation-red fix clear. See
  [BL-1428](BL-1428-standing-red-register.md) for the register/throttle
  this ledger feeds.
- **BL-472** (deferred) — wires mutation/CRAP tooling for Babashka itself, a
  different gap: that one is a tool that does not exist; this one is a tool
  that exists and never gets to run.
- `docs/how-to/BL-848-certify-an-operator-hotfix.md` — the sibling ledger
  this one's storage shape follows.
