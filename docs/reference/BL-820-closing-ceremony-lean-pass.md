# BL-820: Closing-Ceremony Lean Pass

A named step, run before the shift fully winds down, that turns
[BL-819's ticket lifecycle ledger](BL-819-ticket-lifecycle-ledger.md) into a
process outcome — never a silent dump of raw logs, and never a pass that
produces nothing. "A silent ceremony is a failed ceremony": a ceremony run's
own state (pending → `complete` | `failed`) exists so that silence is
detectable, rather than indistinguishable from "the ceremony never ran".

## Shape

1. **The coordinator brings the packet.** `./finish-shift` runs the ceremony
   CLI before it stops the pipeline (while ancillaries and agents are still
   up), which folds that shift's ledger events into a `CeremonyPacket` —
   dwell hotspots, bounce classes, skip reasons, stalls, and 1-3 process
   hypotheses derived from those — and delivers it to the specifier as a
   `note`, never only into the daily briefing.
2. **The coordinator may act within powers it already holds** — promotion
   order or throttle posture — and records that it did, against the same
   shift's run.
3. **The specifier turns the packet into an outcome**: a process ticket, a
   spec/gate tweak, or an explicit "no change". Recording a reasoned
   no-change is success; ending the shift with no recorded outcome is the
   failure this pass exists to prevent.
4. **An empty shift auto-records its own no-change.** If the packet has
   nothing in it (no dwell/bounce/skip/stall events that shift), the
   ceremony records `no_change` itself rather than delivering an empty
   packet and waiting on a specifier turn that has nothing to react to.

## Storage

One durable run record per shift at
`.swarmforge/lean/ceremony/<yyyy-MM-dd>.json` (`CeremonyRun`), holding that
shift's packet plus whatever outcome/adjustments have been recorded against
it since. Every state transition reads the current run fresh from disk
first — never an in-memory copy carried across calls.

```ts
interface CeremonyPacket {
  shiftKey: string;
  pathTaken: string[];
  dwellHotspots: CeremonyDwellHotspot[];   // { role, totalMs }
  bounceClasses: CeremonyBounceClass[];    // { failureClass, count }
  skipReasons: string[];
  stalls: CeremonyStallSummary[];          // { role, eventType, count }
  hypotheses: string[];
}

interface CeremonyRun {
  shiftKey: string;
  packet: CeremonyPacket;
  deliveredAt: string;
  outcome: CeremonyOutcome | null;         // { type, ref, recordedAt }
  adjustments: CeremonyAdjustment[];       // { kind, detail, record, recordedAt }
  failedAt: string | null;
}
```

`CeremonyOutcome.type` is one of `process_ticket | spec_gate_tweak |
no_change`. `CeremonyAdjustment.kind` is one of `promotion_order |
throttle_posture`. Both closed vocabularies — no passthrough.

### Reversible, not silent (human decision 7)

Every `CeremonyAdjustment` carries a `record: { form: 'ticket' | 'note', ref:
<id> }` — a ticket id to grep and revert, or a note pointer to find and act
on. The ceremony itself never edits a constitution article as a side effect
of running; adjustments stay within powers the coordinator already holds
(promotion order, throttle posture), recorded so they are traceable and
reversible from the record alone.

### A stale open run fails loud, not silent

Before folding the current shift, the ceremony finalizes any earlier shift
still `pending` (no outcome recorded) as `failed`, and sends a failure note
to the specifier for each one finalized this way. This is what makes the
ticket's declared invariant hold across a missed shift, not just the current
one: every ceremony run ends in `complete` or `failed`, never stays silently
open forever.

## CLIs

Three thin CLI wrappers (`extension/src/tools/closing-ceremony-*.ts`) over a
pure core (`extension/src/quality/closingCeremony.ts`, no fs) and a single
read/write layer (`extension/src/metrics/closingCeremonyStore.ts`):

### `closing-ceremony-run.js` — the coordinator's automatic step

```sh
node extension/out/tools/closing-ceremony-run.js [--target <path>] [--at <iso-timestamp>]
```

Invoked by `./finish-shift` (via
`swarmforge/scripts/finish_shift_lib.sh`'s
`finish_shift_run_closing_ceremony`), ahead of `kill_pipeline_swarm.sh`, so
the pipeline is still up while it runs. Composes the packet from BL-819's
ledger and delivers it via the real `swarm_handoff.sh` (never a direct
`inbox/new/` write) — the coordinator identity is fixed in the CLI, never
inherited from whatever `SWARMFORGE_ROLE` the invoking shell happens to
carry. A missing compile or a non-zero exit is a loud skip logged by
`finish_shift_lib.sh`, never a bedtime failure — the ceremony is additive to
`./finish-shift`'s own contract (BL-762), not a new way for it to fail
closed.

### `closing-ceremony-adjustment.js` — the coordinator's own record

```sh
node extension/out/tools/closing-ceremony-adjustment.js --shift <yyyy-MM-dd> \
  --kind <promotion_order|throttle_posture> --detail <text> \
  --form <ticket|note> --ref <id> [--target <path>] [--at <iso-timestamp>]
```

Records that the coordinator acted within powers it already holds, against
that shift's ceremony run.

### `closing-ceremony-outcome.js` — the specifier's own record

```sh
node extension/out/tools/closing-ceremony-outcome.js --shift <yyyy-MM-dd> \
  --outcome <process_ticket|spec_gate_tweak|no_change> [--ref <id>] \
  [--target <path>] [--at <iso-timestamp>]
```

Records the specifier's outcome for that shift's ceremony run, ending it in
state `complete`.

## Boundary: what this pass is not

- **Not a fourth stop verb.** It attaches to `./finish-shift` (BL-762), the
  existing bedtime hook — no new shift-close/bedtime code path was added.
- **Not a replacement for the Swarm Optimizer or the human briefing.** Both
  continue unchanged; this pass is an additional consumer of BL-819's
  ledger, aimed at the specifier.
- **Not a mid-shift digest.** It runs once, at shift close, from
  `./finish-shift`; mid-shift signals (a `note` after a harsh bounce wave, a
  human-visible briefing summary) are optional extras, never a replacement
  cadence.
- **Not scope creep onto domain features.** The pass optimizes how work is
  specified, gated, routed and evidenced on the forge itself — it does not
  change product features of whatever is under build, except where the
  domain IS the forge and the evidence demands a process ticket.
- **Not an auto-amendment of the constitution.** Adjustments and outcomes
  are reversible records (ticket or note), never a silent edit to an
  article; a genuine constitution change still goes through Article 5.

## See also

- [Ticket Lifecycle Ledger (BL-819)](BL-819-ticket-lifecycle-ledger.md) — the
  ledger this pass reads; owns event/snapshot schema and write points.
- [Bedtime vs. lights-out: which stop verb to run](../how-to/BL-762-finish-shift-bedtime-vs-lights-out.md)
  — the `./finish-shift` hook this pass attaches to.
- [`extension/src/quality/closingCeremony.ts`](../../extension/src/quality/closingCeremony.ts)
  — the pure packet-fold and validation core.
- [`extension/src/metrics/closingCeremonyRun.ts`](../../extension/src/metrics/closingCeremonyRun.ts)
  — the orchestrator `finish-shift` invokes.
- [`extension/src/metrics/closingCeremonyStore.ts`](../../extension/src/metrics/closingCeremonyStore.ts)
  — the read/write layer for `CeremonyRun`.
