# Specifier disposition — QA's BL-751 note (hold/ pool + "BL-592 code missing")

Answers the priority-`00` note
`00_20260828T004824Z_001797_from_QA_to_coordinator_specifier`
("BL-751 QA-approved 1188f29a17 - hold/ pool + BL-592 code missing, see
evidence"), raised against `backlog/evidence/BL-751-qa-pass-20260828.md`.

Two findings were escalated. One is resolved; the other rests on a false
premise, and the real problem it points at is a different ticket.

## 1. BL-592 is NOT missing, and nothing is at risk of being lost

QA's evidence records BL-592's implementation as "three divergent lineages,
none landed", "**not an ancestor of current `main`**", and "real, substantial,
hardened-in-part work that risks being lost if the branches carrying it ever
get reset."

That reading is incorrect. **BL-592 is a live, complete, correctly-lineaged
parcel sitting in QA's own `inbox/new`:**

```
.worktrees/QA/.swarmforge/handoffs/inbox/new/
  00_20260828T004012Z_000867_from_documenter_to_QA_for_QA.handoff
  type: git_handoff  from: documenter  commit: 82e422a910
  task: BL-592-spec-tree-on-live-console-with-epic-tier
  enqueued_at: 2026-08-28T00:40:12Z
```

Verified against commit `82e422a910`:

| Check | Result |
|---|---|
| `extension/src/bridge/specTreeUiHtml.ts` | present, 254 lines |
| `extension/src/docs/docsTree.ts`, `extension/test/specTreeUiHtml.test.js`, `extension/test/docsTree.test.js` | present |
| `specs/features/BL-592-*.feature`, `docs/how-to/BL-592-*.md`, `backlog/topics/BL-592.json` | present |
| Evidence trail | 7 files: coder pass + bounce-fix, architect bounce/pass/anomaly/content-loss, hardener pass |
| `e5cf2a3af` (coder) ancestor of `82e422a910` | CONFIRMED |
| `feabd9825` (hardener) ancestor of `82e422a910` | CONFIRMED |
| `3cd8e6c173` (architect merge) ancestor of `82e422a910` | CONFIRMED |
| `82e422a910` ancestor of `main` | NO — correctly so; it has not been landed yet |

So the three lineages QA saw as divergent are not divergent: all three are
ancestors of the single documenter tip now queued at QA. The absence of
`specTreeUiHtml.ts` from `main` has the ordinary explanation — **the parcel has
not been processed yet.** It was enqueued at 00:40:12Z, and QA's escalation was
written at 00:48:24Z, eight minutes later, while the parcel sat unread in its
own inbox.

**Specifier ruling: no spec action, no recovery ticket, no retirement.** The
BL-592 spec is current (I pinned its acceptance, cross-milestone epic
modelling and schema-v2 migration on 2026-08-27; `main`'s copy is the finished
spec, not the pre-spec draft). QA should run `ready_for_next.sh` and process
`82e422a910` normally. The correct disposition of "code missing from `main`"
is to land it.

Recorded because the premise mattered: QA declined BL-592's paths out of the
BL-751 merge as out-of-scope, which was **the right call** under BL-506 — the
error is only in the alarm attached to it, not the decline.

## 2. The hold/ pool — one ticket left, and it is now imminent

`f8a41c1e2` ("Retire ... stale duplicate source paths", whose
identical-content claim was false) left five tickets mis-pooled in
`backlog/hold/`. State now:

| Ticket | Then | Now | Status |
|---|---|---|---|
| BL-644 | `hold/` | `done/` | resolved (coordinator) |
| BL-751 | `hold/` | `done/` | resolved — coordinator `80cb34654`, 100% rename |
| BL-1188 | `hold/` | `active/` | resolved |
| BL-1189 | `hold/` | `active/` | resolved |
| BL-592 | `hold/` | `active/` | resolved |
| **BL-1200** | `hold/` | **`hold/`** | **STILL MIS-POOLED — and in flight** |
| BL-472 | `hold/` | `hold/` | correct: genuine deferred human hold |

**BL-1200 is the live problem.** It is `type: defect`, `severity: high`,
`human_approval: approved` — and it is *in_process at QA right now*:

```
.worktrees/QA/.swarmforge/handoffs/inbox/in_process/
  00_20260828T002424Z_000861_from_documenter_to_QA_for_QA.handoff
  task: BL-1200   commit: d474c423e5   dequeued_at: 2026-08-28T00:48:49Z
```

A ticket cannot be simultaneously held and in flight. This is no longer the
latent conflict my 2026-08-28 adjudication left in place — when QA passes
BL-1200, the coordinator's Article 3.3 `active/ -> done/` move will not find
it, and it strands exactly as BL-751 just did.

**This is a pooling decision (Article 3.3), so it is the coordinator's to
make, not mine.** Flagged with the decisive new fact: BL-1200 belongs in
`backlog/active/` **before** QA's verdict lands, not after.

## 3. Recovery push (human-authorized, out of normal role bounds)

The human explicitly authorized the specifier to cross the QA/coordinator push
boundary for the BL-1214 reset recovery, on the grounds that unpushed commits
are precisely what `reset --hard origin/main` destroys, and that the paths were
bookkeeping-only (BL-630 push-sweep allowlist).

- Pushed `1188f29a1..ad515e301` — three commits, all backlog bookkeeping:
  `80cb34654` (BL-751 `hold/`->`done/`, 100% rename), `e3d56b5f0` (BL-751 topic
  record), `ad515e301` (BL-428 `active/`->`done/`). No feature code; working
  tree clean.
- `git rev-list --count origin/main..main` = **0**. Parity confirmed.
- BL-1202..BL-1218 (17 tickets) all on `origin/main` in `backlog/paused/`
  with `human_approval: approved`. No approval was re-flipped by hand.
- Rescue refs deleted only after a **content** test, not ancestry alone
  (BL-954): every id resolves to exactly one copy on `origin/main`, and a
  line-level superset check found nothing held only in a rescue ref except
  BL-592's and BL-644's pre-spec `acceptance: |` draft prose, which the
  2026-08-27 specs deliberately replaced. `rescue/main-before-reset-20260828`
  was *not* an ancestor yet was fully superseded — origin carries the richer
  BL-1214 (`severity: critical` plus four incident notes) against the rescue
  copy's `severity: high`. Deleted: `rescue/BL-1216-spec`,
  `rescue/main-before-reset-20260828`, `rescue/main-post-rescue-20260828`,
  `rescue/specifier-work-20260828-0132`.

## Minor, non-blocking

`backlog/done/BL-751-*.yaml` still reads `status: todo` while sitting in
`done/` — the same cosmetic inconsistency already noted for BL-565. Worth a
tidy pass, not a bounce.

By specifier.
