# BL-1014: Boy Scout scan — debt ranked by recurrence

An on-demand, read-only CLI that reads the technical-debt signals this repo
already keeps, ranks them by **recurrence**, and prints a ranked inventory
with an evidence pointer per item — so a human (or a later automated pass)
can see the most annoying debt without re-deriving it from five different
tools by hand. This is slice 1 (identify) of the `boy-scout` epic; slice 2,
BL-1015, is what acts on the ranking. This slice never edits, mints a
ticket, or cleans anything.

## Why recurrence, not severity

Debt that costs once is just debt. Debt that costs again and again is what
the operator experiences as annoying, and it is the only definition of
"most annoying" that is measurable rather than re-argued every run: an item
attested by three independent sources outranks a nastier-looking one
attested by one. This is also what keeps the scan **deterministic** — no
clock, no randomness, and no fresh judgement call enters the rank key, so
the same repository state always produces the same ranking.

## Run it

```sh
node extension/out/tools/boyScoutScan [path-to-root]
```

`path-to-root` defaults to the current working directory. The CLI resolves
a root, runs the scan, and prints the report to stdout — it touches nothing
else and exits 0.

## The five sources

| Source | Reads | Honest limits |
|---|---|---|
| `deferred-hardening-gate` | `backlog/hardening-debt-ledger.yaml`, via its own CLI `swarmforge/scripts/hardening_debt_ledger_read.bb` — **never** by parsing the YAML directly, per that ledger's own header | A deferred gate is debt by construction: every ledger row is a gate that did *not* run |
| `bounce-recurrence` | `.swarmforge/bounces/<month>.jsonl` | Bounce records carry `ticket`, `producingRole`, `failureClass`, `commit`, `at` — but **not** the files touched, so this slice ranks recurrence by `failureClass`/`producingRole` pair only. Per-file attribution needs a join through each commit and is deferred to the epic |
| `crap-over-threshold` | `npm run crap` (`extension/scripts/crapReport.js`) — reads the existing coverage report, writes nothing | Only rows the report itself marks over-threshold count as debt; the scan does not re-derive or re-decide the CRAP score |
| `duplication` | `npm run dry` (`extension/`, jscpd, pinned config) | A clone implicates both files, so each end is attested separately |
| `runtime-bloat` | Counted entries under `.swarmforge/daemon`, `.swarmforge/handoffs/inbox/completed`, `.swarmforge/bounces`, against declared thresholds (`readers.ts`'s `BLOAT_THRESHOLDS`) | Thresholds are declared, not discovered, so two runs over the same tree agree |

A source that cannot be consulted at all (script missing, no coverage
report yet, etc.) is reported as **`NOT CONSULTED — <reason>`**, never as
clean — "no CRAP debt" and "CRAP was never measured" are opposite facts,
and the report never collapses them. A source that ran and found nothing is
reported as `clean (no signal)`. One source throwing does not take the
whole scan down or shrink the inventory silently; it is isolated per
source.

## The rank key

Evidence is grouped by **subject** — a repo-relative path (or, for
bounce-recurrence, a `<failureClass>/<producingRole>` pair) — and ranked by:

1. `sourceCount` — the count of **distinct sources**, not rows. Three rows
   from one source is one source's opinion; counting rows would let a
   single chatty source outrank genuine cross-source corroboration, which
   is exactly what the rank key exists to measure.
2. Total evidence count, as a tie-break.
3. Subject name, alphabetically, as the final tie-break — so the ordering
   never depends on read/iteration order.

**Subject normalization matters.** The ledger records paths like
`extension/src/tools/x.ts`; `crapReport.js` and `jscpd` both print paths
relative to `extension/` (`src/tools/x.ts`). `normalizeSubject` maps both to
the same key — without it, the same file gets two keys and cross-source
recurrence can never fire for it. (This was found by running the scan
against this repository, not by any unit test: every unit test used
self-consistent subject strings on its own.)

## Reading the report

```
BOY SCOUT SCAN — debt ranked by recurrence

sources consulted:
  deferred-hardening-gate: 5 signal(s)
  bounce-recurrence: 12 signal(s)
  crap-over-threshold: NOT CONSULTED — no CRAP report available (run npm run coverage in extension/)
  duplication: clean (no signal)
  runtime-bloat: 1 signal(s)

ranked inventory (most recurrent first):
  1. extension/src/notify/telegramFrontDeskBotCore.ts — attested by 2 source(s), 3 hit(s)
       [deferred-hardening-gate] backlog/hardening-debt-ledger.yaml: BL-... deferred the ... gate on ...
       [bounce-recurrence] .swarmforge/bounces/: BL-... bounced for ... against ...
  2. .swarmforge/daemon — attested by 1 source(s), 1 hit(s)
       [runtime-bloat] .swarmforge/daemon: 797 entries (threshold 100)
```

Each evidence line names the **artifact** to open (a file or command) and
enough **detail** to find the row inside it — every rank is checkable by
hand, without re-running the scan. An item's evidence list is capped at 5
lines per item (`EVIDENCE_SAMPLE` in `report.ts`); a longer list is stated
as `... + N more (open the artifacts above)` rather than silently
truncated, since a single `.ts` file can routinely carry a hundred
CRAP-flagged functions and printing all of them would bury the ranking the
report exists to convey. An empty inventory still lists all five sources
and their status — a blank report reads the same whether there is no debt
or the scan never looked, so the sources-consulted block is never omitted.

## Boundary: what this slice is not

- **Not a mutation.** Read-only: no source, config, or runtime state is
  written, only the report to stdout. `git status` is byte-identical before
  and after a run.
- **Not BL-428** (the standing on-touch CRAP tracker: one metric, no
  trigger, no ranking). CRAP becomes one of five sources here; BL-428
  remains its standing home.
- **Not BL-820** (closing-ceremony lean pass: forge *process* only, fires
  at shift close). This scan targets code/ops debt, on demand.
- **Not the acting half.** Ranking and reporting only — minting a ticket or
  cleaning anything is [BL-1015](BL-1015-boy-scout-run.md), slice 2 of the
  same epic.

## Source layout

Split along its policy/IO seam (`8274108c3d`, a cleaner pass under BL-485's
mutation-site-size check — behavior-preserving, not a line-count chop):

- `extension/src/tools/boyScoutScan/types.ts` — shared interfaces
- `extension/src/tools/boyScoutScan/rank.ts` — the rank key (pure)
- `extension/src/tools/boyScoutScan/parsers.ts` — the five source parsers
  (pure over already-read data)
- `extension/src/tools/boyScoutScan/report.ts` — the report renderer (pure)
- `extension/src/tools/boyScoutScan/readers.ts` — the only IO, and it only
  reads; each reader is an injected seam so the scan is drivable with no
  repository at all
- `extension/src/tools/boyScoutScan/scan.ts` — wires parsers to readers
- `extension/src/tools/boyScoutScan/index.ts` — the CLI entry and public
  surface

Acceptance feature:
`specs/features/BL-1014-the-boy-scout-scan-ranks-debt-by-what-it-keeps-costing.feature`.
