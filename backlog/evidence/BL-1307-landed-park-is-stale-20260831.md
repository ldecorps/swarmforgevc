# BL-1307 has landed — the park is stale and it is holding an active slot

**Written:** 2026-08-31 ~02:0xZ, by the specifier, from an idle
`ready_for_next.sh` returning `NO_TASK`.
**Disposition:** freeing the slot is **coordinator bookkeeping** (Article 1.1 /
3.3), not a specifier action, so this file is the evidence behind the
priority-`00` note asking for it. Same shape and same remedy as
`BL-1295-landed-park-is-stale-20260830.md`, eight days apart — see the
companion file `BL-1300-hold-is-not-a-withholding-20260831.md` for why this
keeps recurring.

## The park was correct when it was set, and is not correct now

QA verified BL-1307 fully green and then declined to land it
(`6d9e987a07`, evidence `BL-1307-qa-hold-land-step-blind-spot-20260831.md`):
`land_step_lib.bb`'s sibling detector missed BL-1300 as an entangled sibling,
so the tip-pure replay would have carried unlanded BL-1300 content past a
pending human approval. The specifier upheld that hold (`1c23d9db85`). Both
calls were right: it was never a bounce, and no role in BL-1307's chain owns
`land_step_lib.bb`.

The hold stopped the *replay*. It did not stop the *content*: QA had already
merged the documenter tip into `swarmforge-QA` (`4b82155941`), and `main`'s
first-parent chain **is** that branch, so every subsequent land advanced `main`
over BL-1307's merge. BL-1308, BL-1240, BL-1253, BL-1264, BL-1218, BL-1210,
BL-1252 and BL-1225 have each landed since, on top of it.

## Verified on `main` and `origin/main`, not inferred

`git rev-list --left-right --count main...origin/main` → `2 0` (local ahead by
two backlog-bookkeeping commits only; neither ref is stale for these paths).

| # | Check | Result |
|---|---|---|
| 1 | `git merge-base --is-ancestor bd27e884cb main` (QA's merge of the documenter tip) | **YES** — and of `origin/main` too. Real ancestry, not phantom content |
| 2 | `forward-carries-own-evidence?` called from `main:swarmforge/scripts/swarm_handoff.bb` | present, lines 382–396 and 486 — the `required_wiring` anchor is live in the CONSUMER, not just declared |
| 3 | `bl1307ReviewForwardOwnEvidenceSteps` in `main:specs/pipeline/steps/index.js` | **registered**, line 551 — not merely a file on disk |
| 4 | `main:specs/features/BL-1307-...feature` | present, 3 scenarios (1 Outline + 2), byte-identical to the parcel tip |
| 5 | `main:swarmforge/scripts/review_forward_evidence_gate_lib.bb` | `(defn forward-carries-own-evidence?` at line 128 |
| 6 | `git log -S 'forward-carries-own-evidence?' main` | introduced by `6f8227894e` "BL-1307: a review forward must add the role's own evidence for the task" — a commit that genuinely authored it |
| 7 | All six stage evidence files on `main` | coder, architect, hardender, documenter, QA-hold, specifier-adjudication — all present |

Check 3 is the one that matters most: BL-1253's "partial resurrection" failure
mode is a feature file landing with its handler present but *unregistered*,
leaving `main` red. That is not what happened here.

## The recorded blocker is spent

The park's blocker was "BL-1300 must land first, so the replay's inclusion of
its files is byte-identical rather than novel". **BL-1300's content is now on
`main` and `origin/main`** — `9553cf9354`, plus
`extension/test/bl1300HeadroomProofIsPinned.test.js` and
`extension/test/bl1300SingleEnforceableBudget.property.test.js`. So the
condition the park was waiting for is satisfied, by the same passenger
mechanism that landed BL-1307 itself.

That is good news for BL-1307 and **bad news generally** — BL-1300 is in
`backlog/hold/` awaiting a binary human ruling that could still choose the
option that was *not* built. See the companion evidence file.

## What is owed

Nothing by the pipeline. BL-1307 needs no rework, no re-cited commit, and no
bounce — re-citing an upstream non-merge commit to force a land would replay a
partial parcel (BL-1297's blind spot). What is owed is bookkeeping:

1. **QA** confirms the landing independently (the BL-1295 precedent —
   `29f7522fc5`, `BL-1295-qa-confirm-landed-passenger-20260830.md`).
2. **Coordinator** moves `backlog/active/BL-1307-...yaml` → `backlog/done/M8/`,
   rechecks `active_backlog_max_depth` (effective value **2**), and routes the
   next promoted item in the same turn.

By specifier.
