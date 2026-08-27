# BL-1090 — the uncommitted master-worktree draft, captured verbatim

Specifier, 2026-08-23. Captured because the change was sitting UNCOMMITTED in the
master worktree with no ticket, blocking `build_freshness_cli.bb sync`
(`:dirty-surface`), and is one `git checkout` from vanishing.

**This capture is a SURFACE action, not a sweep.** The working-tree files are
left exactly as found. Nothing was committed, reverted, stashed or cleaned.

## Provenance

| Fact | Value |
|---|---|
| Files | `extension/src/concierge/approvalAskReconcile.ts`, `extension/src/concierge/conciergeTick.ts`, `extension/test/approvalAskReconcile.test.js`, `extension/test/conciergeTick.test.js` |
| Working-tree mtime | 2026-08-23 01:48:36 – 01:49:16 BST |
| Base commit | `c152a33e5` (main tip at capture) |
| Author | not an agent parcel — no role byline, no ticket, no branch. `approvalAskReconcile.ts` itself was created out of band by `87546a748` (Laurent Decorps, 2026-07-20, "Fix Approvals asks, board links, Gemini runtime, and epic hygiene gates"), so this is a continuation of the human's own out-of-band module, almost certainly written through Cursor on master. |
| Patch | `backlog/evidence/BL-1090-uncommitted-draft-20260823.patch` (`git apply` clean onto `c152a33e5`) |

## What it does

Extracts `approvalAskRecordedOnLiveTopic(backlogId, recordedAsks, liveApprovalsTopicId)`
from the existing reconcile filter, then uses it in `runConciergeTick` to drop
edge-derived `ApprovalRequested` events whose ask is already recorded against the
LIVE Approvals topic, marking each dropped event emitted so durable dedup catches
up. Remint (recorded ask on a STALE topic id) is deliberately NOT suppressed.

Ships four tests: two unit (`approvalAskRecordedOnLiveTopic` truth table) and two
tick-level (suppression after a lost baseline; remint still re-posts).

## Freshness state at capture

`bb swarmforge/scripts/build_freshness_cli.bb <root> report` — QA approval is
CLEAN (`approved: true`, no offending shas), so the dirty working tree is the
ONLY thing refusing the sync. Four of six supervised processes are stale:

| process | running_sha | main_sha | stale |
|---|---|---|---|
| bridge | `c152a33e5` | `c152a33e5` | no |
| bot | `c152a33e5` | `c152a33e5` | no |
| front_desk_supervisor | `bec57c581` | `c152a33e5` | **yes** |
| handoffd | `bec57c581` | `c152a33e5` | **yes** |
| handoffd_supervisor | `bec57c581` | `c152a33e5` | **yes** |
| operator_runtime | `e1f3f7824` | `c152a33e5` | **yes** |

## Precedent — this is the third time

1. **2026-08-11** — `backlog/archive/INTAKE-resident-pane-live-capture-ttl-cache.md`:
   an uncommitted `extension/src/bridge/*` draft on master, no ticket, blocking
   sync. The human chose **keep + ticket**, and the specifier minted a defect
   ticket treating the draft as the intended landing rather than a greenfield
   rewrite. That is the disposition this ticket follows.
2. **2026-08-20** — `backlog/evidence/BL-935-close-build-freshness-skip-20260820.md`:
   `swarmforge/scripts/daemon_log_freshness.conf` uncommitted, refused the sync
   twice in one night. The coordinator correctly declined to `--override` and
   recorded the debt: *"Still owed to the human: `daemon_log_freshness.conf`
   should be committed (through QA) or reverted, on purpose."*
3. **2026-08-23** — this one.

Each occurrence was handled correctly in isolation and left no standing
mechanism behind, which is why it keeps recurring.
