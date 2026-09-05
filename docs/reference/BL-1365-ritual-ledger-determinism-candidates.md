# BL-1365: Ritual Ledger & Determinism Candidates

A computed answer to "which repeated, hand-made acts on the forge itself
could be scripted?" — folded into the
[closing-ceremony packet](BL-820-closing-ceremony-lean-pass.md) as
`determinismCandidates`, rather than run as a one-off manual sweep (the
2026-09-03 sweep this ticket generalizes).

## The detector, in one sentence

A ritual performed by a **script** collapses to one commit subject every
time; a ritual performed by an **agent** has a long tail of different ones.
Measured on real history before this existed:

| ritual class | commits | top subject count | dominance |
|---|---|---|---|
| `backlog-promotion` (`promote_and_route_next.sh`) | 484 | 484 | ~1.00 |
| `topic-records` (`blTopicStore.ts`) | 2290 | 2228 | 0.97 |
| `pass-bounce-evidence` (no writer) | 2182 | 29 | **0.01** |

**Dominance** — a class's most-common normalized commit subject's share of
that class's total commits — separates scripted from hand-made cleanly and
needs no new instrumentation: it is computed straight from
`git log --name-only`.

## What is, and is not, a ritual class

Ritual classes are **bookkeeping path areas** only —
`extension/src/metrics/ritualLedger.ts`'s `RITUAL_CLASSES`:
`backlog-promotion` (`backlog/active/`), `backlog-closure` (`backlog/done/`),
`pass-bounce-evidence` (`backlog/evidence/`), `topic-records`
(`backlog/topics/`). Creative areas — `extension/src/`, `specs/features/`,
`docs/`, etc. — were measured and rejected: every one clears both
thresholds because writing source or a feature spec is of course hand-made
however varied its subjects are, and offering them as candidates is the
"alert nobody reads" failure mode this ticket exists to avoid. The
distinction that matters is "hand-made AND scriptable", not "hand-made".

## Two independent halves (invariant 1)

**Measurement** and **selection** are deliberately split so that a shift
that runs no closing ceremony loses no measurement:

1. **The producer** (`extension/src/metrics/ritualLedgerProducer.ts`,
   `run-ritual-ledger-producer.js`) walks the last `RITUAL_LEDGER_WINDOW_DAYS`
   (45) days of non-merge commits, classifies each by path, and writes
   per-class volume/dominance/distinct-subject stats to
   `.swarmforge/telemetry/ritual-ledger.json`. It runs on the daemon's own
   sweep cadence — `handoffd.bb`'s `ritual-ledger-producer-sweep!` — never
   inside the ceremony itself.
2. **The ceremony reads, never computes.** `closingCeremonyRun.ts`'s
   `resolveDeterminismCandidates` reads the persisted ledger (returns no
   candidates if none exists yet — a missing ledger is a silent no-op, never
   a shift-close failure) and folds it against currently-open ticket text.

Merges are excluded from the producer's `git log` on purpose: a merge
commit's subject is git-generated, so including them would make every
ritual's merges read as perfectly scripted and dilute the real dominance
figure underneath.

## Thresholds

Both exported from `ritualLedger.ts`, deliberately not buried in a
predicate, because the ticket expects them to need tuning:

- `RITUAL_VOLUME_FLOOR = 50` — below this, a class is too small to be
  worth scripting.
- `RITUAL_DOMINANCE_CEILING = 0.5` — at or above this, a class reads as
  already scripted. The measured spread (0.01 hand-made vs. 0.97–1.00
  scripted) leaves a wide margin either side of 0.5.

A class is offered as a `determinismCandidate` when its commit count meets
the volume floor, its dominance is below the ceiling, **and** it is not
suppressed (below).

## Suppression: the `ritual_class:` ticket field (invariant 2)

A class already named by an open ticket is not offered again — otherwise
the packet becomes a standing restatement nobody reads. "Already named" is
a **declared field**, not text matching: `ritual_class: <id>` (scalar or a
flow list, one physical line — `swarmforge/backlog-schema.md`), checked
against every ticket in `backlog/active/` and `backlog/paused/` only (a
`done/` ticket is finished and must not suppress its class forever; `hold/`
is a human parking space, not a commitment).

Text matching was tried first and measured against the live backlog before
being rejected in both directions: matching a class's path prefix anywhere
in the ticket suppressed `pass-bounce-evidence` on 23 of 104 open tickets
(almost all incidental mentions); matching only the title missed the
2026-09-03 sweep's own findings (BL-1362, BL-1363), which name neither path
in their titles. The field fails toward **firing**: an undeclared ticket
costs the specifier one judgement to dismiss a candidate (already priced in
by invariant 3, below); over-suppression would cost the whole mechanism,
silently.

## The ledger proposes, the specifier disposes (invariant 3)

A `determinismCandidate` is evidence for a ticket, never an auto-minted one.
The specifier reads the packet (delivered the same way as the rest of the
closing-ceremony packet — see BL-820) and decides: mint a ticket
(declaring `ritual_class:` on it), or dismiss it as a reasoned no-change.

## See also

- [Closing-Ceremony Lean Pass (BL-820)](BL-820-closing-ceremony-lean-pass.md)
  — the packet this feeds; owns the packet/outcome/adjustment shape and the
  delivery-to-specifier mechanism.
- [`extension/src/metrics/ritualLedger.ts`](../../extension/src/metrics/ritualLedger.ts)
  — the pure classifier, thresholds, and candidate selection (never reads
  git or the ceremony).
- [`extension/src/metrics/ritualLedgerProducer.ts`](../../extension/src/metrics/ritualLedgerProducer.ts)
  — the git-log sweep and the `ritual-ledger.json` store.
- `swarmforge/backlog-schema.md` — the `ritual_class:` field definition.
