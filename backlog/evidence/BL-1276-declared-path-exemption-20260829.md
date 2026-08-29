# BL-1276 — a ticket's own landed declarations are not foreign

Coder, 2026-08-29.

## Amended mid-parcel: widened from `acceptance:` to declared FIELDS

This parcel was delivered once against the ticket's original shape (exemption
keyed on `acceptance:` alone, commit `25e7922f0`). The specifier then widened
the ticket — after I reported that BL-1251 would still be blocked because it
has no `acceptance:` field at all — so the exemption is now stated over the
ticket's declaring fields, `acceptance:` and the new `retires:`, read through
ONE accessor (`declared-exempt-paths`, the literal the amended
`required_wiring` names). A third declaring field later is one line there, not
a new branch at the call site.

The `retires:` case is the sharper of the two: BL-1006 REQUIRES a retiring
ticket to edit the superseded ticket's feature file ("retire, never reword"),
so before this the gate refused a constitutionally mandated edit.

Deliberately NOT built, per the amendment's own out_of_scope: no predicate
greps the `RETIRE-WITH: <id>` comment inside a feature file. It is
documentation, not a gate input, and its existing usages are not all ticket ids
(one reads "whichever ticket reopens the genuine-conflict recovery path"). The
trust model is the one `acceptance:` already has — the specifier writes the
declaration in the ticket's own landed YAML, and that is the whole authority.

## Both live instances are unblocked (qa_e2e step 7)

With the fix present in this worktree, BL-1246's parcel — committed at
`3c07857a5` since 14:0x and refused ever since — sends:

    $ swarm_handoff.sh tmp/handoff-1246.txt
    HANDOFF DELIVERED: .../outbox/50_20260829T153854Z_001448_from_coder_to_cleaner.handoff

BL-1246's `acceptance:` field is
`specs/features/BL-1230-no-leaked-git-repository-inside-the-working-tree.feature`,
which is exactly the path the gate had been calling foreign. Nothing about
BL-1246 changed; it is the same commit, re-sent.

And after the widening, the second held parcel — BL-1251 at `4ba1d0c9e`,
refused since ~15:26 — sends too:

    HANDOFF DELIVERED: .../50_20260829T155018Z_001450_from_coder_to_documenter.handoff

BL-1251 declares `retires: specs/features/BL-1248-master-main-reconcile-kill-switch.feature`.
Note the recipient: it routed to the **documenter**, honouring BL-1251's own
`required_stages: [coder, documenter, qa]` through the existing routing seam —
so the unblock did not quietly bypass anything else.

## What the exemption is, and what it is not

A path is not foreign when it is **the exact path string** the task's own
ticket declares in its `acceptance:` field, read from the ticket's **landed**
YAML. Verified through the real `swarm_handoff.bb` against real git fixtures,
one row per feature Example:

| declaration | changed path | outcome |
|---|---|---|
| `acceptance:` the same path | `specs/features/BL-1230-guard.feature` | **delivered** |
| `acceptance:` that path | `backlog/active/BL-1230-guard.yaml` | refused |
| `acceptance:` its own feature file | `specs/features/BL-1230-guard.feature` | refused |
| `retires:` the same path | `specs/features/BL-1248-switch.feature` | **delivered** |
| `retires:` that path | `backlog/active/BL-1248-switch.yaml` | refused |
| no declaration of that path | `specs/features/BL-1230-guard.feature` | refused |
| landed says own; working copy says the changed path | `specs/features/BL-1230-guard.feature` | refused |
| ticket resolvable nowhere | `specs/features/BL-1230-guard.feature` | refused **+ the note** |
| declaration landed on main, sender branch never merged it | `specs/features/BL-1230-guard.feature` | **delivered** (qa_e2e step 4) |

Each row is driven through the real `swarm_handoff.bb` against a real git
fixture, and each declaration is written in its field's REAL yaml shape —
`acceptance:` a scalar, `retires:` a list — so the accessor is exercised as it
is actually fed, not through a normalised stand-in.

Rows 2 and 5 are invariant 2's exactness, once per declaring field: a sibling
path of the SAME foreign ticket is still reported. Row 7 is invariant 3: a
sender cannot grant itself an exemption by editing its own working copy. Row 9
is the same invariant from the other side — a declaration the specifier landed
on `main` is honoured even though the sender's branch forked before it, which
is the whole reason the read goes to the ref rather than the tree.

## Reuse, not a second reader

The declaration is read through `swarm_handoff.bb`'s own BL-992 lookup
(freshest of `main`/`origin/main` first, exact `id:` match, working-tree glob
only as a last resort). That reader was private to `swarm_handoff.bb`, so it is
extracted verbatim into `swarmforge/scripts/landed_ticket_lib.bb` and both
callers now delegate to it. No second copy of the ref-freshness logic — which
matters twice over here, because the read happens inside
`findings-for-git-handoff`, the ONE impure entry point shared by the send-time
gate and BL-1257's review-time CLI. Putting it anywhere else would let those
two answer the same commit differently, which is BL-1257's own invariant 2.

`foreign-scope-findings` stays pure: the declared paths are an input to it, and
its old two-argument shape still works unchanged (a unit test pins that). It
accepts either a bare path string or a collection, so BL-1192's own callers and
the widened one share one function.

## A refusal that cannot be satisfied is the thing this ticket removes

When the ticket cannot be read at all, the exemption grants nothing — and the
refusal now says so:

    ... NOTE: the declared-path exemption could not be evaluated - BL-1246's own
    ticket could not be read on main, origin/main, or in backlog/active/, so a path
    it declares for itself (acceptance:/retires:) was not recognised. Check the
    ticket is present and landed before rebuilding anything.

Without that sentence the fix would reproduce the shape it exists to remove: a
refusal reading as a plain entanglement, sending its recipient off to rebuild a
commit that did not need rebuilding. Both callers pass the flag, so the
review-time CLI never says less than the send-time gate about the same commit.

## Superseded section: BL-1251 under the pre-amendment shape

Re-tested after the fix:

    Cannot send git_handoff for BL-1251: ... carry a path
    (specs/features/BL-1248-master-main-reconcile-kill-switch.feature) belonging
    to BL-1248 ...

BL-1251 has no `acceptance:` field at all — its deliverable (retire BL-1248
scenario 04) is defined purely in prose — so there is no declaration to exempt
anything, and the exemption correctly grants nothing. Note the refusal carries
**no** "could not be evaluated" note, because BL-1251's ticket read fine; it
simply declares nothing. That distinction is the message discipline working.

That was true of the ticket's ORIGINAL shape and is what prompted the
amendment. It no longer holds: BL-1251 now declares `retires:` and sends. The
`RETIRE-WITH`-grep predicate I suggested in
`backlog/evidence/BL-1251-handoff-blocked-by-task-scope-gate-20260829.md` was
deliberately NOT adopted — the specifier chose a declared field over grepping a
prose comment, which is the sturdier of the two and is now recorded in
out_of_scope as a firm line. Kept here because the reasoning is still the
record of why the widening happened.

## Nothing BL-1192 shipped was weakened

- `specs/features/BL-1192-pre-handoff-task-scope-gate.feature`: **9/9 pass**,
  unchanged.
- `task_scope_gate_lib_test_runner.bb`: ALL PASS, with eleven new cases.
- `bl992_declaration_ref_lookup_property_runner.bb`: ALL PROPERTIES HOLD (100
  draws through the real CLI) — the extracted reader behaves identically.
- `test_required_stages_ticket_lookup_collision.sh`: PASS — the BL-9005/BL-900
  false-collision guard survives the extraction.
- No new bypass, env var, or override flag exists. The predicate is derived or
  it does not exist.

## Invariants

All three are encoded in
`swarmforge/scripts/test/task_scope_gate_acceptance_exemption_property_runner.bb`
(300 draws each, reach floors asserted rather than hoped for), and the runner is
registered in `suite-manifest.tsv` so the standing suite accounts for it.

The exactness property is CONSTRUCTED, not sampled: every generated case pairs
the declared path with a sibling path derived from the SAME foreign ticket id,
because that pairing is where the failure lives — an exemption keyed on the
foreign TICKET rather than the PATH passes any case carrying only the declared
path. Non-vacuity, both shown and restored:

| deliberate break | what fails |
|---|---|
| exempt by foreign ticket id instead of exact path | P1, naming the sibling it wrongly exempted |
| let a nil declaration exempt everything | P2, on the no-declaration draws |
| read `acceptance:` but not `retires:` | the unit runner's one-accessor case, and P1 with "the accessor did not read :retires's declaration" |

Acceptance: 8/8 (six Outline rows plus scenarios 02 and 03).

## One thing the rename cost, recorded

The amendment renamed the feature file AND its `Feature:` line. My step handler
was already written against the old title, so every scenario failed with "no
step handler matched" until the `FEATURE` constant was re-tensed with it — the
same matched-pair trap BL-1251's own ticket warns about, hit here from the
other direction. The constant now carries a comment naming its pair.
