# BL-531 — architect SEND BACK #1 (2026-07-24)

**Verdict: SEND BACK to coder.** The QA bounce is genuinely fixed, but the fix
it landed — Check A condition 5 — does not exclude the commit shape it was
written for, and the gate refuses a legitimate QA-bound handoff on this very
parcel.

Reviewed commit: `179fe7264` (cleaner-forwarded coder work), merged into
`swarmforge-architect` as `3a57a807f`. Ancestry holds:
`git merge-base --is-ancestor 179fe72643 3a57a807fe` → true.

## What passes

- **QA bounce (unhandled scenario outline) is FIXED.** Acceptance
  `BL-531-pre-qa-durability-wiring-gate.feature` → **15/15** (was 13/15).
- **The new tests are non-vacuous**, verified by break-then-restore:
  - neutering `no-dropped-work?` in `pre_qa_gate_gather_lib.bb` → exactly tests
    **14 and 15 fail**, all 13 others pass;
  - neutering the `(not (contains? no-dropped-work-set sha))` clause in
    `pre_qa_gate_lib.bb` → unit runner **3 failures**, naming both exclusion
    shapes and the "only the real fix survives" negative case.
  Both files restored; worktree clean.
- **Step handler validates against explicit known values** (regex alternation on
  the two Examples strings + `else throw`) — engineering.prompt's Scenario
  Outline rule, satisfied.
- **Dependency-rule hard gate (BL-259)**: `node
  extension/out/tools/dependency-gate.js` full-repo → *PASSED, no forbidden
  edges* (exit 0). No `extension/src/*.ts` in the parcel.
- **Co-change (BL-255)**: no pair at or above the default frequency-3 threshold;
  every reported pair is 1–2 and is a new file with no history. Nothing flagged.
- **Layering is exactly right, and better than the spec required.** All new git
  access (`commit-parents`, `tree-of`, `empty-diff-against-first-parent?`,
  `no-dropped-work?`) went into the **gather** layer;
  `pre_qa_gate_lib.bb` gained only an injected `:no-dropped-work-set` and stays
  a total function of plain data — still zero git/fs/process. High-level policy
  remains independent of I/O.
- **Scope is clean (BL-506)**: 4 files, all BL-531. The untracked
  `swarmforge/scripts/test/test_swarm_handoff_mono_router_auto_rotate.sh` is
  unrelated operator tooling and was correctly left unstaged.
- **Property testing (architect-owned phase)**: no `extension/src/*.ts` pure
  module touched, so there is no fast-check target in this parcel. The pure
  decision surface is `pre_qa_gate_lib.bb` (Babashka); its gate is the `.bb`
  unit runner per engineering.prompt's tool table — green (`ALL PASS`). No
  property test added; none warranted.

## BLOCKING — condition 5 does not exclude the shape it was built for

Condition 5's headline is *"carry dropped work **the cited commit does not
already have**"*. As shipped it recognises only two shapes: a merge whose diff
against its **first parent** is empty, or a commit whose **tree is identical**
to the cited commit. Neither matches a role's ordinary ticket-naming merge,
because such a merge's first-parent diff is exactly the incoming parcel (never
empty) and its tree carries the role branch's own prior content (never
identical).

### Reproduction — on this parcel, with this commit

Temporarily blank BL-531's own `abandoned_commits:` escape hatch (restored
immediately afterwards) and run the shipped self-check:

```
$ bash swarmforge/scripts/pre_qa_gate.sh BL-531-pre-qa-durability-wiring-gate 179fe72643 .
PRE_QA_GATE_FAIL ancestry BL-531 3a57a807fe stranded on swarmforge-architect   (exit 1)
```

`3a57a807fe` is **my own architect review-merge of this parcel**:

```
$ git show -s --format="%h parents=%p%n%s" 3a57a807fe
3a57a807f parents=87a03cfdb 179fe7264
Merge BL-531 from cleaner for architect review

$ git merge-base --is-ancestor 179fe72643 3a57a807fe   # → true
```

Its **second parent is the cited commit**. It *contains* the parcel in full. It
cannot possibly carry dropped BL-531 work — and yet:

```
$ bb -e '(load-file "swarmforge/scripts/pre_qa_gate_gather_lib.bb")
         (pre-qa-gate-gather-lib/no-dropped-work? "." "<3a57a807fe full>" "<179fe72643 full>")'
false        ;; ← NOT excluded
```

The same holds for `aca611925c`, the commit the new code comment names by hand
as *"the false positive this excludes"*:

```
$ bb -e '... (no-dropped-work? "." "<aca611925c full>" "<179fe72643 full>")'
false        ;; ← NOT excluded either
$ git diff --quiet aca611925c^ aca611925c ; echo $?
1            ;; first-parent diff is NOT empty — it is the whole coder parcel
```

So the comment at `swarmforge/scripts/pre_qa_gate_gather_lib.bb:40-45` is
factually wrong: condition 5 does not exclude `aca611925c`. The only reason
this parcel currently self-checks `OK` is the specifier's hand-added
`abandoned_commits: - "aca611925c"` — a per-sha manual override, not the
mechanism.

### Why this blocks

The refusal is wired into `swarm_handoff.bb::validate`, the single chokepoint
every handoff passes through, and hot-syncs to every worktree the moment this
lands on `main` (BL-373). From then on, **any role that merges a parcel with a
ticket-naming merge message and then forwards something other than its own tip
strands a ticket-naming merge on its branch**, and the next QA-bound handoff for
that ticket is refused. That is not an edge case:

- a batch role forwarding one isolated ticket commit out of a bundle — the
  cleaner's *required* behaviour under Article 2.6 (this is literally how
  `aca611925c` came to exist);
- a reviewer that merges, bounces, and later re-reviews;
- any re-send after a bounce.

The remedy each time would be a specifier edit adding another sha to
`abandoned_commits:` — mid-parcel, blocking a QA handoff. That is precisely the
"thing people work around at 3am" that `specifier_decisions` 5 was written to
avoid, and it realises the ticket's own flagged #1 risk: *"A false positive
stops the pipeline, not just one parcel."*

### Remediation

A merge commit introduces no content of its own — its content is the union of
its parents, and any genuinely dropped fix lives in a **non-merge** commit that
names the ticket and is a candidate in its own right. So the exclusion needs to
cover the ordinary merge, not only the degenerate empty one. Concretely, extend
`no-dropped-work?` so a 2+-parent candidate is excluded when it introduces
nothing of its own (e.g. `git diff-tree -m --cc` / `--first-parent` shows no
merge-unique hunks), rather than requiring `git diff --quiet <first-parent>
<sha>` to be empty. Then:

- re-point the code comment at a shape it actually excludes;
- add the acceptance Example for this shape (a merge whose second parent **is**
  the cited commit) alongside the two existing ones, plus the matching unit case;
- keep the existing negative case green — a genuine single-parent stranded fix
  must still be a finding.

Condition 5's enumerated shapes are written into the ticket YAML and the feature
file, so this likely needs a **specifier amendment** to condition 5's wording
(BL-317/BL-325: amend on `main`, then `note` the holder). The headline clause
already states the intent, so the widened rule is inside it, not beyond it —
but do not silently diverge from the enumerated list without that amendment.

## Secondary (fix in the same pass; not blocking on its own)

`no-dropped-work?` documents itself as failing **closed** — an unreadable
candidate is *not* excluded and therefore refuses the send — and it emits no
warning. The ticket's contract is the opposite: *"Anything that prevents a check
from running … prints a warning naming the check that could not run and
**allows** the send."* Since the coder will be inside this function anyway,
align the fail direction with the contract (or, if fail-closed is deliberate for
an exclusion check, at minimum emit the named warning so the operator can see
which check could not run).

## Not a defect — recorded so it is not re-raised

`aca611925c` remaining in `abandoned_commits:` is correct and should stay: it is
a genuinely stranded commit that carries no BL-531 work, and the escape hatch is
the reviewable, in-git override the design intends. The complaint above is that
it is currently the *only* thing making this parcel pass, not that it is wrong.

## Branch hygiene note

The bounced merge `3a57a807f` was **not** reverted out of `swarmforge-architect`.
BL-490/BL-495's revert rule targets an **abandoned** parcel; this one is in an
immediate rework loop, its content has been reviewed and is largely sound, and
`git revert -m 1` followed by the coder's re-merge would silently drop the
unchanged hunks of the fix (the merge-drops-fix hazard). This follows the
established practice on this ticket — QA merged, then committed its bounce on
top (`4215223b5` → `c440ebad3`) without reverting, and the coder merged that
bounce for lineage. **If BL-531 is ever abandoned rather than reworked, this
merge must be reverted from `swarmforge-architect`.**
