# BL-474 — Unknown-stage root-cause audit (pipeline board fragility)

Investigation deliverable for BL-474 ("why does an active ticket's swarm stage
become UNKNOWN — is 'not started' always honest?"). Enumerates every path by
which a ticket lands in `backlog/active/` and every path by which it becomes /
leaves role-held, classifies each resulting not-started case as
legitimate-transient vs tracking-defect, and files concrete follow-ups for the
real defects.

Recorded 2026-07-17 (operator-driven audit). Read-only; no code changed.

## Architecture under audit

The board's active rows are a **lazily-invalidated cache with an LLM as its only
invalidator**:

```
coordinator LLM ──(remembers to run)──▶ pipeline_stage_cli.bb sync
                                            │ reads role in_process mailboxes + backlog/active/
                                            ▼
                        .swarmforge/board/ticket-stage-map.json   ← the cache
                                            │
   concierge tick (~30s) ─ reads the file, never recomputes ──────┘
                                            ▼
        computePipelineBoard → renders ONLY role-held tickets (row = role-held ∩ active)
```

Data-path files:
- `swarmforge/scripts/pipeline_stage_cli.bb` — `compute-stage-map` = `filter-active(reconcile-stage-map(pairs, role-order), active-ids)`; `sync` atomically writes the JSON.
- `swarmforge/scripts/pipeline_stage_lib.bb` — `extract-ticket-id` (`^([A-Za-z]+-\d+)`, upper-cased), `ticket-id-from-headers` (task OR message → note-aware), `reconcile-stage-map` (most-downstream role wins), `filter-active` (drops ids not in active set, case-sensitive).
- `extension/src/swarm/swarmState.ts` — `readTicketStageMap` (tolerant read, `{}` on missing/corrupt), `invertTicketStageToRoleHeldTickets`.
- `extension/src/concierge/conciergeTick.ts` `syncBoardIfWired` — reads the file each tick, feeds `computePipelineBoard`.
- `extension/src/concierge/pipelineBoard.ts` — grid rows built ONLY from the role-held map.

**Freshness dependency (grep-confirmed):** the only non-test invoker of
`pipeline_stage_cli.bb` is the coordinator, via `coordinator.prompt` (line 220).
No daemon, cron, or tick recomputes it. The prompt further tells the coordinator
"Do NOT self-schedule polling" (line 244), so refresh is strictly event-driven,
best-effort, and depends on the LLM remembering `sync` after "every moment your
knowledge of parcel location changes."

## Live evidence (2026-07-17 ~07:59 UTC)

- `backlog/active/` held 6 tickets: BL-439, BL-473, BL-476, BL-481, BL-484, BL-485.
- `.swarmforge/board/ticket-stage-map.json` held **2**: `{"BL-485":"specifier","BL-473":"coder"}`.
- Board therefore under-reported by 4 rows (BL-439, BL-476, BL-481, BL-484 invisible).
- Checked every role's `in_process` mailbox: none of the 4 missing tickets is
  held anywhere. Only specifier + coder had `in_process` handoffs (both
  `type: note`), resolving to BL-485 / BL-473. → the 4 missing were **genuinely
  not-started (promoted-but-not-dequeued)**: this instance was 100%
  legitimate-transient, exactly the BL-473 render-anyway case.

## Path enumeration & classification

### Paths INTO backlog/active/
- Coordinator promotes a paused/queued ticket → active file appears.
- (No other writer moves a ticket into active/.)

### Paths INTO / OUT OF role-held (map presence)
- Coordinator kicks a promoted ticket to a role by **note** or **git_handoff** → id lands in that role's `in_process` → resolves (note-aware).
- Role finishes and hands off → id leaves that mailbox; next role dequeues → moves downstream.
- Between the two: a brief window where no role holds the id.

### not-started cases classified

| Case | Cause | Verdict |
|---|---|---|
| Promoted, not yet dequeued | no role holds it yet | **legitimate-transient** (the live 4) |
| Brief between-stages gap | handed off, next not dequeued | **legitimate-transient** |
| Stale cache: coordinator changed routing but did not `sync` | held ticket shows wrong/absent stage until next sync | **TRACKING DEFECT** |
| Held via header not leading with the id | `extract-ticket-id` misses it | **TRACKING DEFECT** |
| Lower-cased `id:` in yaml | asymmetric case-normalization, active-set join fails | **TRACKING DEFECT (latent)** |
| Corrupt/torn map file | reader → `{}` → whole grid empties silently | **TRACKING DEFECT (latent, low prob)** |

## Findings (ranked)

1. **Stale-cache freshness, no watchdog `[REAL, highest]`** — board freshness =
   last time the coordinator remembered `sync`. A skipped/crashed/cooldown'd
   sync leaves a genuinely-held ticket mis-staged for an unbounded time. The
   "authoritative source" is really a lazily-invalidated cache with an LLM as
   sole, event-driven invalidator.
2. **Board drops unresolved active tickets `[REAL under-report]`** — row set =
   role-held ∩ active, not active. Live: 4 of 6 dropped. **Owned by BL-473**
   (render physical `backlog/active/` membership; unheld → not-started row).
3. **Leading-token-only id extraction `[REAL, latent]`** —
   `extract-ticket-id` requires the id as the FIRST token of the task/message
   header. A held ticket whose note doesn't lead with its id (`"Re: BL-476 …"`,
   a wrapped prefix) resolves to nothing → durable false not-started,
   indistinguishable on the board from legit not-started.
4. **Asymmetric case normalization `[latent]`** — BL-471 upper-cases the header
   side of the join, but `active-ticket-ids` reads yaml `id:` verbatim. A
   lower-cased `id:` silently fails the active-set join → ticket vanishes with
   no error. Defend both sides.
5. **Triplicated id-regex + two divergent role-held readers `[drift risk]`** —
   the id regex is copied across `pipeline_stage_lib.bb`, `chase_sweep_lib.bb`,
   and TS `extractTicketId`. `swarmState.readInProcessTicketIds` (VS Code panel)
   is task-header-only / note-blind, while the board's bb path is note-aware, so
   panel and board can disagree about what a role holds.
6. **Silent total wipe on corrupt/empty map `[low]`** — corrupt file → `{}` →
   whole grid empties, presenting identically to "no active work." Atomic-move
   makes it rare but the failure is silent and total; wants a "map empty while
   active/ non-empty" guard/log.

## Recommended follow-up tickets (BL-474's mandate)

- **F-1 (from finding #1): board freshness independent of the coordinator.**
  `pipeline_stage_cli.bb report` is side-effect-free; have the concierge tick
  recompute (shell out to `report`, or reimplement the invert in TS over live
  mailboxes) instead of trusting the coordinator-written cache. Collapses the
  entire staleness class (and most of #6). Highest leverage — the real answer to
  "fragile board" beyond BL-473's render-anyway patch.
- **F-2 (from finding #3): id-extraction robustness.** Resolve a held ticket
  whose header does not lead with the id (or make the coordinator's note/task
  header contract enforce a leading id). Feature: a role-held ticket with a
  non-leading id still resolves to its stage.
- **F-3 (from finding #4): symmetric case-normalization.** Upper-case the
  active-set `id:` side of the join too, so a mis-cased yaml id cannot silently
  drop a ticket.
- (Findings #5/#6 are lower priority — note them for a future consolidation /
  guard pass; not blocking.)

## Verdict

"Not started" is **honest in the common case** (promoted-but-not-dequeued /
between-stages — the live 4 confirmed this), but it is **NOT always honest**:
findings #1, #3, #4 are real tracking-defect paths where a genuinely-held ticket
can durably read as not-started. BL-474 therefore closes NOT with a
"not-started is always honest" finding, but with follow-ups F-1..F-3 filed for
the real defects (F-2/F-3 get their own Gherkin acceptance; F-1 is the
architectural fix). BL-473 continues to own the render-anyway visibility fix.
