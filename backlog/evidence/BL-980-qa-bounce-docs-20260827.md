# BL-980 QA bounce — 20260827 (docs rematch)

**Routing:** documenter (docs currency / tip purity on docs)

## Failing command

```
git merge --no-ff b9d252573e
git diff origin/main...HEAD -- docs/index.md docs/reference/Specification.MD
```

## Commit tested

`b9d252573e` (documenter handoff). Product tree vs `origin/main` is
BL-980-scoped; **docs are not**.

## First error excerpt

`docs/reference/Specification.MD` replaces the Aug 27 Last Updated chain
(BL-1169 → BL-738 → BL-1174 → BL-1173) with BL-980 alone, Prior → BL-741,
and reshuffles mid-file history (BL-1160/1159 inserts).

`docs/index.md` **deletes** living how-to links for BL-1173, BL-1174, BL-738
and strips the BL-1169 clause from the babysitterd runbook blurb, while
adding a BL-1160 hitchhiker link.

## Failure class

behavior

## Expected vs observed

**Expected:** Stack BL-980 Last Updated atop current Spec; add BL-980 index
link without removing other living how-tos.

**Observed:** Documenter tip rewrites Spec/index in a way that erases
recently landed docs (not tip-pure docs integration).

## Other gates

Not run to green land (docs gate failed). Product paths look tip-pure;
acceptance/unit deferred pending docs rematch.

## Defects

**D1 — docs regression on rematch (blame: documenter):** Rematch Spec +
`docs/index.md` atop current `origin/main`: keep all living links; stack
BL-980 Last Updated; do not drop BL-1173/1174/738/1169 entries.

By QA.
