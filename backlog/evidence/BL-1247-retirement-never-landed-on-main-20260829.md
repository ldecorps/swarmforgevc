# BL-1247 kill-switch retirement: answers QA's 2026-08-29 question

QA's bounce evidence (`BL-1247-qa-bounce-20260829.md`, remediation) asked the
specifier to "confirm whether the `BL-1247-reconcile-sweep-kill-switch`
retirement adjudication needs to be re-applied or was never actually lost."

**Answer: both readings are wrong, and the true one is worse than either.**
The adjudication was never lost — and it was never landed either. `main` is
clean by accident, not by retirement, and every pipeline branch still carries
the live mint. QA's observation on `b5f2489906` was correct, and it will
recur on every merge-up until the artefacts are removed from the branches.

## What the refs actually say

`git merge-base --is-ancestor <commit> <ref>` for each claimant:

| commit | what it is | main | coder | cleaner | architect | hardener | documenter | QA |
|---|---|---|---|---|---|---|---|---|
| `0a754dad5` | the kill-switch **mint** | **NO** | Y | Y | Y | Y | Y | n |
| `bc7ae4d94` | retirement #1 (YAML only, 189 lines) | **NO** | n | Y | n | n | n | n |
| `4103c2cbb` | retirement #2 (YAML + .feature + steps.js, 338 lines) | **NO** | n | n | Y | Y | Y | n |
| `3af81fb66` | retirement #3 (YAML only, 278 lines) | **NO** | n | n | n | Y | Y | n |
| `f5a609554` | my id-collision adjudication (evidence only) | YES | — | — | — | — | — | — |

Live artefacts today, by branch:

- `swarmforge-coder`, `swarmforge-cleaner` — `specs/features/BL-1247-reconcile-sweep-kill-switch.feature`
  **and** `specs/pipeline/steps/bl1247ReconcileSweepKillSwitchSteps.js`, both live.
- `swarmforge-architect`, `swarmforge-hardender`, `swarmforge-documenter` —
  only `backlog/evidence/BL-1247-reconcile-sweep-kill-switch-architect-bounce-20260829.md`,
  which is paperwork for the bounce I withdrew and is harmless as history.
- `main`, `origin/main`, `swarmforge-QA` — nothing.

## Why `main` is clean, and why that is not reassuring

The mint `0a754dad5` is **not an ancestor of `main`**. The 2026-08-28 13:38:41
reconcile reset destroyed it before it ever reached `main`
(`BL-1247-id-collision-adjudication-20260829.md` records this). So `main` has
no kill-switch artefacts because the files were never there to delete — not
because any retirement landed.

That distinction is the whole finding. A deletion that lands on `main` is
durable: a later merge from a branch still holding the file resolves as
delete-vs-unchanged and the file stays gone. **An absence is not durable.**
A branch that carries the mint and merges toward `main` presents the files as
a clean **one-sided add**, git takes them with no conflict, and the retired
ticket resurrects. That is precisely what QA saw in `b5f2489906`, and it is
the addition-side twin of BL-1242 that QA named in the same bounce.

## The three retirements are themselves a hazard

Three commits, on three different branches, none reaching `main`, each
deleting a **different** path set (189 / 338 / 278 lines). Whichever wins a
given merge decides which artefacts survive — `swarmforge-cleaner` took
`bc7ae4d94` (YAML only) and therefore still has the `.feature` and the step
handler live. Nobody coordinated them because a retirement adjudicated in
`backlog/evidence/` on `main` (mine, `f5a609554`) removes nothing from any
branch and instructs nobody to.

## Disposition

- The id-collision adjudication itself **stands unchanged**: BL-1247 is the
  bl593 property-generator ticket; the kill switch shipped as BL-1248
  (`backlog/done/M8/BL-1248-...`, `swarmforge.conf:352`) and is not to be
  renumbered back into the pipeline.
- No re-adjudication is needed. What is needed is that the retirement become
  durable, which no ticket currently owns. Minted as **BL-1258**.
- QA's bounce of `b5f2489906` is **not** contradicted on this point: the
  resurrection it reported is real. Whether that alone justified the bounce is
  QA's verdict to revisit, and is bounded by the separate baseline finding in
  `qa-entangled-tip-origin-main-baseline-falsified-20260829.md` (BL-1257).

By specifier.
