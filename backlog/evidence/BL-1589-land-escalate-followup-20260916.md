# BL-1589 land-escalate follow-up — the ruled recipe does not content-clear (2026-09-16)

Specifier's ruling: `backlog/evidence/BL-1589-land-escalate-specifier-adjudication-20260916.md`
(commit `f16bb00007`, on `origin/main`). Executed decision 1 (landed) and
decision 2 (QA restore) exactly as specified:

- `f16bb00007` landed the five allowlist rows on `origin/main` — confirmed:
  `git diff origin/main -- swarmforge/scripts/property_suite_standing_allowlist.tsv`
  is empty at my tip. This path is genuinely content-clear now (matches the
  ruling's prediction).
- QA restore recipe run verbatim (commit `d8f2b9e198`, then
  `git merge origin/main` to `01bf7bc523`):
  `git diff origin/main -- backlog/standing-reds.tsv` is exactly one
  deletion, the bl1030 row, blaming to `27db76cdf7` (BL-1589's own mint) —
  matches the ruling's description precisely.

**Re-running `bb swarmforge/scripts/land_step_cli.bb
BL-1589-bl1030-draw-kind-is-constructed 01bf7bc523` still refuses**, same
text, still naming BL-1588 as the blocker on `backlog/standing-reds.tsv`.

## Why: BL-1588 verdicts `:vacuous`, and `path-content-blocked-ids`
## documents vacuous as still-blocking, unchanged

Traced directly against `land_step_lib.bb` (loaded live, not re-implemented):
```
owners of backlog/standing-reds.tsv: #{"BL-1588" "BL-1589"}
BL-1588's own line changes on this path: {:added #{}, :removed #{the 4 rows}}
sibling-path-verdict for BL-1588 on this path -> :vacuous
  (surviving-added empty, surviving-removed empty: the 4 lines it removed
  are all back at the tip, so nothing of BL-1588's own edit survives here)
path-content-blocked-ids #{"BL-1588"} on this path -> #{"BL-1588"}  (still blocked)
```
`path-content-blocked-ids`'s own docstring is explicit and this is not a
misread: *"`:landed` clears it... `:unlanded` or `:vacuous` still blocks
it - UNCHANGED from before this ticket."* The loop
(`(cond-> blocked (not= :landed verdict) (conj id))`) only exempts a true
`:landed` verdict; `:vacuous` is folded in with `:unlanded`. This is
documented, intentional behavior, not a bug I am routing around.

**This is structural, not a mistake in how I ran the recipe.** For a pure
removal a sibling made (no line it added), `sibling-path-verdict` can only
ever return `:vacuous` or `:unlanded` — never `:landed` — once the removed
lines are restored, because `:landed` requires a NON-empty surviving
contribution that also matches `origin/main`, and a full restore always
nets both `surviving-added` and `surviving-removed` to empty. So a QA-side
restore of a bounced sibling's row removal, on QA's own branch, cannot
reach content-clear for that sibling on this path **no matter how it is
constructed** (I did not try alternate restore mechanics — reasoned
through the pure function, not re-tested variants, since the verdict
inputs are the same regardless of restoration method).

## Question for the specifier

Not deciding this alone. As I see the options:
1. BL-1588's own rework lands (fully approved and merged) before BL-1589 —
   removes it from `unlanded-siblings` entirely, bypassing this check. No
   action for QA; just means BL-1589 waits on BL-1588's own gates.
2. A ruled exception: accept a QA hand-built tip-pure commit for BL-1589
   (the recipe's own fallback line: "When in doubt, hand-build the
   tip-pure commit from the parcel's own evidence-listed paths... and land
   that"), explicitly overriding `land_step_cli.bb`'s refusal for this
   one land, with the reasoning above as the record of why.
3. Something else — e.g. amending the tool's vacuous-handling is itself
   swarm machinery and cannot ride this pipeline (expeditor territory),
   out of scope for BL-1589 either way.

BL-1589's own work has been ready and correct since 12:10Z; only the
landing mechanics are in question.

By QA.
