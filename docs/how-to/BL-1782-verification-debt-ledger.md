# The verification-debt ledger (BL-1782)

## Why

Human, 2026-09-26 (verbatim): replace ad hoc LLM work with tools "wherever
it makes sense", and enforce that "even harder on the swarm engine" than a
coordinator duty alone. The prompting case: QA grepped a branch by hand for
which paths belonged to a ticket before trusting the land step's keep/drop
classification. It worked, but re-deriving that check from scratch every
session means two sessions can do it differently, and a prompt rule saying
"notice this and ask for a tool" is itself an LLM remembering a policy
rather than a mechanical one. This ledger is the register that does the
noticing instead: roles record what they checked by hand, and a script
counts it. It is the third register in the family, alongside
[the standing-red register](BL-1428-standing-red-register.md) and
[the hardening-debt ledger](BL-942-hardening-debt-ledger.md).

The full rule for **when a role owes a row**, worked examples, and the
owning/discharging/waiving lifecycle are constitution prose, not repeated
here: see
[`verification-debt-ledger-2026-09-26.md`](../../swarmforge/constitution/articles/reference/verification-debt-ledger-2026-09-26.md).
This page is the mechanism's shape, for anyone reading the ledger state
rather than recording into it as a pipeline role.

## Recording a row

```bash
bb swarmforge/scripts/verification_debt_ledger_update.bb <project-root> --record <category> \
    --ticket <id> --role <role> --description "<what was checked by hand>" \
    [--evidence <path>] [--on YYYY-MM-DD]
```

`<project-root>` is the master checkout — the recorder commits the row
there itself (`commit_integrity_lib.bb`, the same lock the front desk and
coordinator bookkeeping share), so a row never rides a parcel and is never
lost to a bounce. `<category>` is a kebab-case id for the *kind* of check
(e.g. `land-path-ownership`), never the ticket. A second record for the
same `(category, ticket)` pair is a no-op: nothing is written, exit 0,
`VERIFICATION_DEBT_ALREADY_RECORDED <category> <ticket>`. A bad category,
an unresolvable ticket id, or a blank description refuses (exit 1, nothing
written, names the field). A record that leaves the category unowned at or
over the threshold prints `VERIFICATION_DEBT_UNOWNED <category>
count=<n> threshold=<t>` — the role's cue to note the specifier.

## Reading outstanding debt

```bash
bb swarmforge/scripts/verification_debt_ledger_read.bb <project-root>
```

Prints one JSON object:

```json
{
  "categories": {
    "<category>": {
      "count": 4, "threshold": 3, "over_threshold": true, "owned": false,
      "owners": [], "rows": [ { "category": "...", "ticket": "...", "role": "...",
                                 "description": "...", "detected_at": "...", "evidence": null } ]
    }
  },
  "unowned": ["<category>", ...]
}
```

`owned`/`owners` come from a top-level `verification_category:` line on an
open ticket (`backlog/paused/` or `backlog/active/`) naming the category by
exact id — a closed ticket or bare prose never owns it, so the mechanism
fails toward reporting unowned. The threshold is
`swarmforge.conf`'s `verification_debt_threshold` (default 3), read the
same way `standing_red_max_count` is. An absent ledger reads as no
categories. Read-only: this CLI never writes `backlog/verification-debt-ledger.yaml`.

## Where it lives

```
backlog/verification-debt-ledger.yaml   the ledger itself
```

Landed seeded with four `land-path-ownership` rows (all role QA, detected
2026-09-26 — BL-1711, BL-1748, BL-1764, BL-1768), already at the default
threshold on arrival. No owner is minted yet; the specifier mints one the
first time the reader reports the category unowned.

## What is not here yet

Discharge and waive verbs, and the reader's exclusion of settled rows, are
BL-1783. The intake throttle that drops `active_backlog_max_depth` to 1
while a category sits unowned is BL-1784.

## Verify

```bash
bb swarmforge/scripts/test/verification_debt_ledger_lib_test_runner.bb
node specs/pipeline/cli.js specs/features/BL-1782-hand-verifications-are-recorded-in-a-verification-debt-ledger.feature
```
