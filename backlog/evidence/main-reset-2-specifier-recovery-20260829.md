# Second main reset of 2026-08-29 — specifier recovery record

Coordinator note (priority 00, 13:17Z): "2nd main reset this shift
(ba4d65fd4); recovered BL-1267/68/1262 dupes".

The reset at reflog `HEAD@{13}` (`reset: moving to origin/main` →
`ba4d65fd4`) discarded 18 local commits. The coordinator recovered the
retirements and re-promotions. This record covers what was **still
missing** afterwards, and what was done about it.

## Recovered by the specifier (cherry-pick -x from reflog)

| New commit | Lost commit | Content |
|---|---|---|
| `7b117484a` | `747c1d8ac` | Spec BL-1273 + BL-1271 + BL-1272 (3 YAML + 3 feature files, 710 lines) |
| `011bce7ec` | `a061794b7` | BL-1273 `human_approval: approved` |
| `4c8c3bc13` | `160709655` | BL-603 inline `acceptance:` → `specs/features/BL-603-*.feature` |
| `2bc68d50f` | `c692ef727` | BL-1273 note: BL-1262's four files already reached main |
| `0ea5ff214` | `36ca459df` | Size-envelope discharge on BL-1193 and BL-1182 |

BL-1271, BL-1272 and BL-1273 had been erased **entirely** — no YAML, no
feature file, nothing in any backlog folder. Verified after recovery:
`specifier_backlog_hygiene_gate.sh` ok on all six touched YAMLs;
`gherkin_lint_gate.sh` clean on all four feature files.

## Retired by the specifier

- `backlog/paused/BL-581-documenter-owns-diagram-currency.yaml` — shipped
  zombie. BL-581 was QA-passed and closed (`6ac24b99f`, still in history);
  the reconcile merge reintroduced the **pre-spec** copy (inline
  `acceptance: |`, no `qa_e2e_procedure`) into `paused/`. The dedupe commit
  `c6debbd03` was itself eaten by the reset. `done/` holds the authoritative
  copy. Full cross-folder scan finds no other duplicate ticket id.

## Still outstanding — NOT the specifier's lane

1. **BL-1262 is a zombie in `backlog/active/`.** It was QA-passed
   (`backlog/evidence/BL-1262-qa-pass-20260829.md`, `8450de59e`) and closed
   by `852a65dc5` "Close BL-1262: move to done" — that closure was destroyed
   by this reset. The YAML now reads `status: todo`, `assigned_to: coder`,
   so it is promotable and will be rebuilt. Coordinator bookkeeping:
   move `active/` → `done/`.
2. **An operator directive is still lost.** `4e040765b` "Reprioritize
   best-of-breed-swarm epic to top per operator directive 2026-08-29:
   BL-1180->0, BL-1182->1, BL-1183->2; bump BL-1172, BL-667 to priority 1"
   is absent from `main`. Current values are BL-1180=3, BL-1182=5,
   BL-1183=6, BL-1172=0, BL-667=0 — the pre-directive ordering. Recover with
   `git cherry-pick -x 4e040765b`. This is the second shift running in which
   a reset has destroyed an operator directive.
3. **`6e64ab9a7` "BL-603: route to coder"** was also lost. BL-603's spec is
   restored (above) and spec-ready in `paused/`; routing is coordinator's.

## Note for whoever resets next

The reflog is the only copy. Do not `git gc` or `git prune`. Recover with
`git cherry-pick -x <sha>` from `git reflog`, and check
`git merge-base --is-ancestor` before redoing work by hand.

## Verified against QA's rescue ref — and why a merge was the wrong shape

QA staged `rescue/main-before-recovery-20260829` (= `03b92b8dc`, the
pre-reset tip) and asked specifier/coordinator to do "the recovery merge in
the master checkout, where the ticket-pool judgment calls belong"
(`6a8f9d638`). The judgment call is that **a merge is the wrong instrument
here**. `git diff rescue/main-before-recovery-20260829 HEAD` shows `main`
has moved on in ways the rescue ref cannot know about: since that tip,
BL-581 and BL-1222 closed into `done/`, BL-1246 was promoted, and BL-1146
and the pid-lock-verdict ticket were retired out of `paused/`. Merging the
ref back would reintroduce every one of those superseded copies — four
zombies and one duplicate — the same pool-refilling-by-git failure the
reset itself caused. Selective `cherry-pick -x` of the five genuinely
missing commits was taken instead, and the resulting diff against the
rescue ref is now fully accounted for: every remaining difference is either
newer work on `main`, or one of the two coordinator-lane items above.

## Correction to "nothing lost"

QA's note (`00_20260829T131922Z_001932`) reads "2 more main-resets, nothing
lost, rescue ref staged". Nothing was lost *irrecoverably* — the rescue ref
and reflog held everything, which is the point QA was making and it is a
good one. But work was lost **from `main`** and stayed lost until this
recovery: three whole tickets with their feature files, a recorded human
approval, a feature-file migration, two size-envelope discharges, a ticket
closure, and an operator directive. A reset whose casualties are recoverable
still reads to every downstream role as work that was never done. The
distinction matters because BL-1262 was, at the time of that note, sitting
in `active/` as a promotable zombie four hours after QA had passed it.
