# Closing ceremony — shift 2026-09-13 (specifier lean pass, BL-820)

Packet: `.swarmforge/lean/ceremony/2026-09-13.json`, `deliveredAt`
2026-09-13T00:00:00Z, read via the coordinator's priority-00 note
(`00_20260913T042550Z_008081`), received directly after the 2026-09-12
failure note (see `closing-ceremony-2026-09-12-specifier.md`). The run was
`pending` on arrival, so the outcome is recorded in the store this time.

**Outcome recorded: `process_ticket`, ref BL-1551.** A second finding of
the same pass is minted as BL-1552 and named here; both are in
`backlog/paused/`, `human_approval: pending`.

## What the packet showed

Folded at 04:25Z, so a four-hour sliver (BL-1456, owned): four tickets
walked the whole chain — BL-1460 (coder from 09-12, closed 00:49Z),
BL-1464, BL-1482, BL-1484 — every stage a few minutes, no bounces, no
skips. Path taken coder → cleaner → architect → hardender → documenter →
QA. Dwell hotspots coder 2021072ms (BL-1460's own `processingMs`, a
parcel begun the previous evening), QA 1564728ms, hardender 1132519ms.
Stalls: cleaner chase ×7 + respawn ×1, architect chase ×7 + respawn ×1,
hardender ×5, documenter ×4, QA ×4, coder ×2. Hypotheses: coder dwell;
cleaner chase pattern. Quality dial: raise ×6 on stalls (advisory, the
coordinator's half).

## The signal I acted on — BL-1551

The two `respawn` stalls did not happen. The ledger rows (cleaner
00:14:09Z on BL-1460, architect 02:05:48Z on BL-1482) coincide to the
second with `chase-respawn-skip-busy` in the daemon log; no
`chase-respawn` line exists for either. `apply-inbox-item-action!`
(`chase_sweep_lib.bb` ~468) writes `{:type "respawn"}` unconditionally
after calling `:trigger-respawn!`, and the live adapter (`handoffd.bb`
~2104) returns after the busy check without touching a pane. The same
mislabel put "QA respawn ×12" into the 2026-09-12 ledger during BL-1546's
hand-land — a claim the previous pass had to talk itself out of by
reading the daemon log. A lean instrument reporting an intervention that
never happened is a process defect in the pass's own evidence, and it
was unowned (BL-1416 covers the busy predicate; BL-870 covers wake
attribution; nothing covers the respawn rung's row).

Minted **BL-1551** (`type: defect`, `severity: medium`, epic BL-818): a
`respawn` row means a launch script or rotation was invoked; a declined
or failed attempt is `respawn-skipped` with a reason, composed by the
ledger as its own attention signal. Three scenarios (one outline of
four rows).

## The second finding — BL-1552

Not in the packet; in the same shift's git history. At 04:21Z the
architect committed BL-1484's NONE inventory to
`extension/backlog/evidence/`, reverted it 30 s later and rewrote it at
the root path. `git log --all -- extension/backlog/` shows that slip five
times by four roles since 2026-09-07, and `git ls-files` shows three
files still on main under `extension/backlog/evidence/` (BL-1278
hardender, BL-1478 cleaner, BL-1464 QA) with no copy of that pass under
`backlog/evidence/`. Cause: the role's shell was in `extension/` (npm
runs there) when it wrote a relative `backlog/evidence/…` path; no commit
guard looks at where a backlog path sits, and the forward-time evidence
gate (BL-1307) only refuses a forward whose ONLY evidence is a stray.

Minted **BL-1552** (`type: defect`, `severity: medium`, epic BL-541): a
cheap-tier pre-commit guard refusing any staged path whose backlog AREA
directory is not at the root (never the bare word, so
`extension/src/backlog/` stays allowed), naming the root path; the three
strays move home in the same parcel. Four scenarios (two outlines), the
census pinned in scenario 04 (BL-1445).

## Signals I looked at and did not act on

- **Coder dwell 34 min (BL-1460).** One parcel's own processing across
  midnight; the fold window (BL-1456) makes it the "longest" of a
  four-hour sliver. Nothing to ticket.
- **Chase ×1 per role per ticket, cleaner ×4 on BL-1460.** Mono-router
  rotation waits; the chaser emits one row per ~38 s sweep. Known shape.
- **`qualityRecommendations`** raise ×6: advisory.
- **Determinism candidates** `pass-bounce-evidence` (0.019),
  `backlog-promotion` (0.195), `backlog-closure` (0.491): the same three
  as every pass since 09-06, still no open `ritual_class:` declarant
  (BL-1479 declared `backlog-promotion` and is in `done/M8/`). BL-1552
  touches the evidence-commit ritual's PATH, not its scripting, so it does
  not declare `pass-bounce-evidence` — a false declaration would only
  hide the class. Not ticketed, same reasoning as the 09-08..09-12 passes;
  expect them again.
