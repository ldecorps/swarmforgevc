# Strand check — QA note "BL-1243 landed tip-pure again (BL-1241), coder branch entangled w/ BL-670"

**Received:** `00_20260830T034437Z_001991_from_QA_to_specifier` (priority 00)
**Disposition:** signal registered, nothing stranded, **no ticket minted**.

QA.prompt's BL-1241 step 2 requires QA to name every entangled sibling in what it
sends, because "a silent rebuild loses the signal that the branch was entangled at
all — the signal the coordinator and specifier need". This note IS that signal, not
a request for action. What the signal obliges the specifier to do is check whether
the rebuild left content stranded, since a tip-pure rebuild is a landing decision
and sweeps nothing.

## 1. The paths QA excluded from the rebuild — both landed

QA isolated BL-1243's own 13 files by excluding two BL-670-named paths (BL-670 was
`status: todo, assigned_to: coder`, mid-bounce-cycle, so not landable at the time).

| path | on `main` | on `origin/main` |
|---|---|---|
| `backlog/active/BL-670-…yaml` | moved to `done/` | still `active/` (origin lag) |
| `backlog/done/BL-670-…yaml` | YES | not yet pushed |
| `backlog/evidence/BL-670-…bounce-20260830.md` | YES | YES |

BL-670 completed its own cycle independently (`b2a7ebbaf` QA pass, closed by
`e1b4c1620`). Nothing from the exclusion is orphaned.

## 2. `abandoned_commits:` — both are ancestors of `main`

`abandoned_commits: [c339946666, b64714f946]`. Both are on `main` AND `origin/main`,
carried in by later merge-ups. Severing descent did not orphan their content.

## 3. The PRIOR recurrence is also resolved

`205fdd36f` ("Scope my three step-handler files…"), abandoned by the BL-1273 rebuild
on 2026-08-29 and recorded then as stranded on five branches with no ticket carrying
it, is now an ancestor of `main` and `origin/main`. That strand closed itself.

## 4. BL-1243's own content landed complete

Checked against the ticket's own `required_wiring:`, on `main`:

- `extension/src/bridge/residentPaneLive.ts` → `activitySignal` **2 refs**, including
  the writer `activitySignal: derivePaneActivitySignal(paneText)` (line 187). The
  BL-419/BL-298 "reader with no writer" shape the ticket exists to close is closed.
- `specs/pipeline/steps/index.js` → `bl1243LiveScreenPerPaneActivitySteps` registered.
- Feature file, unit test, property test, step handler: all present on `main`.

## 5. The drop hazard is real — it already bit once on this ticket

`b86ef5e28`: *"land the original bounce evidence file, referenced by bounce_history
but dropped from the earlier tip-pure rebuild."* A replay of "only this ticket's own
paths" silently omitted a file the ticket's own `bounce_history` referenced, and it
took a separate follow-up commit to land it. Already remediated; recorded here
because the failure mode is a property of the remedy, not of this parcel.

## Why no ticket

The falsified-baseline cause (`origin/main` lags local `main` by design — 7 commits
at check time) is owned by **BL-1257**, which has shipped: `swarmforge/roles/QA.prompt`
now carries the BL-1241 section naming `task_scope_gate_lib.bb` and
`pre_qa_gate_lib.bb` and the `abandoned_commits:` override. Minting anything here
would duplicate a landed fix.
