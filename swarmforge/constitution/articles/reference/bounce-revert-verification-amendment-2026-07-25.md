# AMENDMENT (INCORPORATED): verifying a bounce revert, and when not to revert

> **Status: INCORPORATED, 2026-07-25** (Article 5.1 step 2).
> The binding form now lives in `articles/reference/workflow-detailed.prompt`,
> section **"A Bounce Must Be Reverted — BL-490/BL-495 Incident"**. This file is
> the adoption record and rationale — read that section, not this file, for the
> rule in force.
>
> **Origin:** two `rule_proposal` parcels from the **architect**, both scoped
> `constitution`, both raised during BL-590's bounce sequence:
> `20260725T095008Z_000540` (from bounce #2) and `20260725T112532Z_000544`
> (from bounce #5). Operator ruled 2026-07-25: accept both, as one amendment,
> B first then A as a guarded exception.

## 1. What the rule said, and why half of it could never be obeyed

The rule (BL-490/BL-495, 2026-07-17) tells a bouncing reviewer to revert the
review-merge out of their own branch, then:

> confirm the content is gone:
> `git merge-base --is-ancestor <bounced-commit> HEAD` must now be FALSE.

**That check can never be FALSE.** `git revert` adds a commit that undoes content;
it does not rewrite history. The bounced commit remains an ancestor of `HEAD`
forever. Demonstrated on a throwaway repo:

```
revert applied: Revert "review-merge of feature"
  git merge-base --is-ancestor <bounced> HEAD   -> TRUE   (rule demands FALSE)
  the introduced file                            -> GONE  (the revert worked)
```

So a reviewer who follows the rule sees the verification fail on a revert that
worked perfectly. Two outcomes, both bad: they either treat a correct revert as
broken, or they learn to skip the verification. The second is worse, because it
retires the only check the rule had.

The architect's diagnosis was exact: *"ancestry is topological, revert only removes
content."*

## 2. What the rule now says (change B — the correction)

Verify the **content**, not the ancestry. The bounced paths must be absent from
the tree; the commit remaining an ancestor is expected and means nothing.

This is a pure bug fix. There was no judgement to make: the old instruction was
unsatisfiable.

## 3. When NOT to revert at all (change A — the guarded exception)

If the bounced commit is **already an ancestor of `main`**, do not revert it out of
the bouncing branch. Record why in the bounce evidence and report the breach to the
coordinator instead.

**Why.** Reverting content that is already on `main` writes a negative delta into
the review branch. The next merge from `main` has to resolve it, and it can resolve
it in the revert's favour — silently stripping `main`'s own code out of the review
tree.

**Not hypothetical.** 2026-07-25: the architect's BL-590 bounce revert was on course
to remove the operator's BL-629..635 ticket filings, and needed an explicit
exclusion commit (`90d0d79f2`, *"Keep main's BL-629..635 filings out of the BL-590
bounce revert"*). It held on one reviewer's vigilance, not on a mechanism.

**Why it does not weaken the original rule.** BL-490/BL-495 exists to stop
un-reviewed content becoming an ancestor of a later approved commit. If the content
is already on `main`, that harm has already happened — not reverting cannot make it
worse, while reverting creates a *new* harm. Once the horse has left the barn, do
not burn the barn.

## 4. The exception is guarded, deliberately

An unguarded exception to a safety rule widens until it is the rule. So this one is
narrow and carries obligations:

- It applies **only** when `git merge-base --is-ancestor <bounced> main` is TRUE.
  Not "when reverting looks risky", not "when the merge is messy".
- The reviewer **must** record the reason in the bounce evidence, so the
  non-revert is visible rather than inferred from an absence.
- The reviewer **must** report the breach to the coordinator. Un-reviewed content
  on `main` is an incident in its own right, independent of this ticket's bounce.

Skipping either obligation turns the exception into "I did not revert because it
was awkward", which is exactly what it must not become.

## 5. This exception should become rare

The condition is *un-reviewed content already on `main`* — which is the BL-590
incident itself, and which BL-629/630/631/632 exist to prevent at four layers
(commit time, publish time, deploy time, detection). As those land, the exception
should almost never fire. If it starts firing routinely, that is a signal those
gates are not holding, and it is worth reading as one.

## 6. What was NOT changed

- The core duty stands: **on bounce, revert the review-merge out of your branch**,
  in the same step as sending the send-back note. Only the verification method
  changed, plus the one narrow exception above.
- The "latent in EVERY branch that already merged it" paragraph stands unchanged,
  including that whoever abandons a bounced parcel owns clearing it upstream.
- `git revert -m 1 <review-merge>` remains the mechanism. A plain `git revert` still
  fails on a merge.

## 7. Provenance

Raised by the architect from real bounces rather than from review of the rule text —
it found the unsatisfiable check by trying to obey it, and found the main-ancestor
hazard by nearly causing it. Both parcels sat in the specifier's queue for hours
because rotation preference ignores parcel priority (**BL-636**), which is why the
operator ruled directly.
