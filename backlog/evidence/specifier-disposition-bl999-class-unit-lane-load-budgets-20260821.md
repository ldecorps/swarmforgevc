# Specifier disposition — BL-999-class unit-lane load budgets — 2026-08-21

Received: coder `note` 20260821T033709Z_000407 to specifier+coordinator,
"BL-999-class: 6 unit-lane reds are load artifacts; evidence 25412a8f1b".
The coder explicitly left the call to me: "whether they fold into BL-999 or
mint their own ticket is the specifier's call".

Status: **disposition PARTLY settled, ticket NOT yet minted** — a clarifying
question is pending with the operator (see below). This file is the durable
resume context.

## Decision 1 (settled, mine): do NOT fold into BL-999

BL-999 is `human_approval: approved`, scoped to ONE file
(`renderBriefingBurndownCli.test.js`) plus the BL-969 guard, and carries an
explicit constraint: "This ticket is not a licence to give every test in the
file an override." Folding five more files into it breaks INVEST-Small and
rewrites approved scope. Whatever ships for these files is its own ticket.

## Decision 2 (settled, mine): the note's six reds are THREE shapes, not one

The note buckets all six as one class. They are not, and a ticket written to
the single bucket would sweep two of them:

| Shape | Files | Current budget | Note |
|---|---|---|---|
| **A — on the bare 20000ms suite default, now exceeded** | `dependencyGateCliStorageGlobals` (1 test), `briefingDigestLineCli` (2 tests), `startBridgeHeadlessCli` (1 test) | none — suite default | Verified 2026-08-21: these files carry **no** per-test override at all |
| **B — has a measured override, headroom now thin** | `renderBriefingDiagramsCli` (1 test) | 45000ms (set by BL-914, 2026-08-19) | 69.2s file / ~31s test against 45s = ~69% consumed, two days after it was set |
| **C — not a budget failure at all** | `bounceWatcher` (`startBounceWatcher wires real fs.watch into the debounce`) | n/a | a *timing* failure (`boundedWatchWait`), not a timeout. Passes 35/35 in 2.9s isolated |

## Reproduced field data

The coder's evidence file
(`backlog/evidence/coder-found-defect-unit-lane-load-budget-timeouts-20260821.md`)
is on the coder's branch at `25412a8f1b` and is **not on `main`** — verified
with `git merge-base --is-ancestor` against both `main` and `origin/main`.
The load-bearing rows are therefore reproduced here rather than left as a
pointer (same practice BL-999's own `notes:` used for `9ff014998`).

Host: 4 cores. Full-lane run at load 158/145/129; isolation sweep at load
96-135. Load is 25-45x core count throughout — the resident swarm was live.

Full lane (1650s): 6 failed / 7991 passed across the 5 files above.
**Clean sequential isolation, one file at a time: ALL SIX PASS.**

`dependencyGateCliStorageGlobals`, the one with a recorded history:

| When | Context | Duration | Result |
|---|---|---|---|
| BL-948 lane run | full lane | 6386ms | PASS |
| BL-946 lane run | full lane | 8289ms | PASS |
| BL-815 classification 2026-08-17, load 47.8-50.4 | isolated | 10746ms | PASS |
| BL-1003 refix lane (mtime 02:05, 29min BEFORE BL-1002's first commit) | full lane | 28852ms | FAIL |
| BL-1002 lane run | full lane | 21379ms | FAIL |
| Clean isolation 04:27, load ~100 | isolated | ~26s file total | PASS |

The coder also records that an earlier "isolation" re-run overlapped the
still-running full lane and its FAIL results are **void** — recorded so
nobody re-runs it.

## Why this went to the operator rather than straight to a ticket

This is the **fourth** measured budget raise in four days on the same
surface:

- **BL-815** (done) — classify five timeouts. Human directive in its
  constraints: *"Do not make these green by raising the 20s budget, skipping,
  widening exclude globs, or deleting coverage."*
- **BL-914** (done, 2026-08-19) — measured per-test overrides for six heavy
  subprocess/render tests. One of those overrides is shape B above, already
  69% consumed two days later.
- **BL-969** (in flight) — raised ONE burndown test to 90000ms on a measured
  basis.
- **BL-999** (paused, approved) — its two siblings still carry a stale
  45000ms; strengthens the BL-969 guard from *presence* to *relation*.
- **today** — three more files, never measured at all, now over the default.

And BL-815 examined `dependencyGateCliStorageGlobals` directly on 2026-08-17
and recorded **"no fix ticket. Comfortable isolated margin"** — at load ~50.
At load ~100 the same test takes ~26s. That classification decayed silently,
which is the same family BL-999 already names (BL-986 false zero, BL-987 dead
archive, BL-998 live-state guards): an assertion that holds while the thing
it guards does not.

The structural read: an **absolute wall-clock budget cannot survive a host
whose contention swings 3x**. Every raise is correct at measurement time and
stale within days. A fifth measured raise is knowingly buying a sixth, and
sits awkwardly against the human's own BL-815 directive — which is why the
shape is the operator's call, not mine.

Checked before asking: no existing paused/active ticket covers load-relative
budgets or lane-load gating. BL-791 (epic, unit-suite SPEED) is adjacent but
is about total suite duration, not per-test budget vs. host load; its open
slice C ("hold the line") is the nearest neighbour.

## Question pending with the operator

Raised via `role_ask.bb` 2026-08-21, `"asked":true`. Options offered:

1. Measured per-test overrides again (settled convention, expect a 5th round)
2. Bound the lane load — do not run the full lane at 40x core count
3. Make budgets load-relative to a recorded contention factor
4. Move heavy subprocess/render tests to their own serial lane

What each implies for the ticket:

- **(1)** smallest ticket: measure and override shape A's three files, revisit
  shape B's 45000ms. Follows BL-914/BL-969 precedent exactly. Known to decay.
- **(2)** lane-execution policy — touches how every role verifies. Fixes the
  cause rather than the symptom; largest blast radius.
- **(3)** budget compares against a recorded contention factor rather than a
  bare number. **Hazard to spec against:** a genuinely 3x-slower test still
  passes if load happens to be 3x. Would need a separate absolute ceiling.
- **(4)** the ~6 subprocess/render tests get their own serial lane and budget.
  Contains the problem without repricing every test.

Shape C (bounceWatcher timing) is out of all four and needs its own line in
whatever ticket results — it is not a budget at all.

## On resume

The answer arrives either in the live pane or as a `note` from
`ready_for_next.sh` on a later rotation. On resume: mint the ticket in the
shape the answer names, epic `code-quality-gates` (BL-999's epic) or
`swarm-reliability` (BL-815/BL-914's), `type: defect`. Severity `medium` —
same argument BL-999 makes: a loud, contained flake that costs reviewer turns
and erodes trust in the lane, but nothing ships wrong because of it. It has
now cost the coder a full verification pass during someone else's ticket, for
the second time (BL-969 was the first).

Do NOT re-run the isolation sweep to "confirm" — the coder's sweep is clean
and recorded, and re-running it at a different load proves nothing new.

By specifier.

---

## Resolution — operator answered 2026-08-21, tickets minted

The operator chose option **(3) make budgets load-relative to a recorded
contention factor**. Two tickets, both `backlog/paused/`, epic
`code-quality-gates`, milestone M8, `type: defect` / `severity: medium`:

- **BL-1007** — shapes A and B. The unit lane's budget becomes relative to a
  recorded contention factor, bounded by a finite absolute ceiling.
- **BL-1008** — shape C, split out as this file predicted it would have to
  be. `boundedWatchWait.js`'s own `DEFAULT_TIMEOUT_MS = 10000` is the same
  disease one layer down; `depends_on: [BL-1007]` because the fix consumes
  the factor BL-1007 records.

### Correction to this file's option-(3) hazard note

The hazard recorded above — *"a genuinely 3x-slower test still passes if load
happens to be 3x; would need a separate absolute ceiling"* — named the right
remedy for the wrong reason, and the ticket is written to the corrected form.

A regression check comparing *load-normalized duration* against the *base
budget* collapses: `duration/factor > base` is algebraically identical to
`duration > base × factor`, i.e. to failing the scaled budget itself. It is
not a second signal, so it cannot be the safety net. Normalization recovers a
test's INTRINSIC cost, so it is only a regression signal against a recorded
intrinsic BASELINE — which needs stored history and is out of this slice.

What actually carries the hazard is the ceiling: past a finite wall-clock
value a test fails regardless of load. That is BL-1007 invariant 2. The
normalized duration is still recorded, but as *attribution* (invariant 1),
not as a gate.

### Two constraints found while scoping, both now in the ticket

1. **The property lane is excluded.** `vitest.properties.config.mjs` records
   that Vitest's bundled birpc layer has a hardcoded 60000ms `onTaskUpdate`
   heartbeat that no public config option can raise. Scaling a property
   budget past it buys nothing and fails the run by a different mechanism.
2. **The helper cannot live in compiled output.** `vitest.config.mjs` is
   evaluated before any compile step has necessarily run and
   `extension/out/` is gitignored, so a config importing from `out/` takes
   the whole lane down rather than failing one test.
   `extension/src/metrics/resourceTelemetry.ts` already exports the needed
   `sampleHostLoadRatio(loadavg1m, cpuCount)` — injectable and unit-tested —
   so the ticket reuses it rather than minting a second sampler, but its
   placement has to respect this.

### IR-DRY judgment recorded

BL-1007's feature file went 7 findings -> 1 by folding the literal-vs-
placeholder scenario split into a single Scenario Outline. The one remaining
`possible-synonym` — "a unit-lane test file whose source declares an explicit
base budget" vs "a unit-lane test whose base budget is `<base>` ms" — is kept
deliberately: one is about source TEXT read by a parser, the other about a
runtime VALUE, and collapsing them would conflate exactly the two things
invariant 3 exists to keep apart. BL-1008's file has zero findings.

By specifier.
