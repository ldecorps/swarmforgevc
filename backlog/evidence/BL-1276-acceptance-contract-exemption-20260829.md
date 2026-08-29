# BL-1276 — a ticket's own declared acceptance contract is not foreign

Coder, 2026-08-29.

## The live instance is unblocked (qa_e2e step 7)

With the fix present in this worktree, BL-1246's parcel — committed at
`3c07857a5` since 14:0x and refused ever since — sends:

    $ swarm_handoff.sh tmp/handoff-1246.txt
    HANDOFF DELIVERED: .../outbox/50_20260829T153854Z_001448_from_coder_to_cleaner.handoff

BL-1246's `acceptance:` field is
`specs/features/BL-1230-no-leaked-git-repository-inside-the-working-tree.feature`,
which is exactly the path the gate had been calling foreign. Nothing about
BL-1246 changed; it is the same commit, re-sent.

## What the exemption is, and what it is not

A path is not foreign when it is **the exact path string** the task's own
ticket declares in its `acceptance:` field, read from the ticket's **landed**
YAML. Verified through the real `swarm_handoff.bb` against real git fixtures,
one row per feature Example:

| declared | changed path | outcome |
|---|---|---|
| `specs/features/BL-1230-guard.feature` | the same path | **delivered** |
| `specs/features/BL-1230-guard.feature` | `backlog/active/BL-1230-guard.yaml` | refused |
| `specs/features/BL-1246-own.feature` | `specs/features/BL-1230-guard.feature` | refused |
| none | `specs/features/BL-1230-guard.feature` | refused |
| landed says own; working copy says the changed path | `specs/features/BL-1230-guard.feature` | refused |
| ticket resolvable nowhere | `specs/features/BL-1230-guard.feature` | refused **+ the note** |

Row 2 is invariant 2's exactness: a sibling path of the SAME foreign ticket is
still reported. Row 5 is invariant 3's derivation-from-the-landed-declaration:
a sender cannot grant itself an exemption by editing its own working copy.

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

`foreign-scope-findings` stays pure: the declared path is an input to it, and
its old two-argument shape still works unchanged (a unit test pins that).

## A refusal that cannot be satisfied is the thing this ticket removes

When the ticket cannot be read at all, the exemption grants nothing — and the
refusal now says so:

    ... NOTE: the acceptance-contract exemption could not be evaluated - BL-1246's
    own ticket could not be read on main, origin/main, or in backlog/active/, so a
    path it declares as its acceptance contract was not recognised. Check the
    ticket is present and landed before rebuilding anything.

Without that sentence the fix would reproduce the shape it exists to remove: a
refusal reading as a plain entanglement, sending its recipient off to rebuild a
commit that did not need rebuilding. Both callers pass the flag, so the
review-time CLI never says less than the send-time gate about the same commit.

## BL-1251 is NOT unblocked by this, and that is correct

Re-tested after the fix:

    Cannot send git_handoff for BL-1251: ... carry a path
    (specs/features/BL-1248-master-main-reconcile-kill-switch.feature) belonging
    to BL-1248 ...

BL-1251 has no `acceptance:` field at all — its deliverable (retire BL-1248
scenario 04) is defined purely in prose — so there is no declaration to exempt
anything, and the exemption correctly grants nothing. Note the refusal carries
**no** "could not be evaluated" note, because BL-1251's ticket read fine; it
simply declares nothing. That distinction is the message discipline working.

BL-1251 stays blocked at `4ba1d0c9e`, and the second predicate suggested in
`backlog/evidence/BL-1251-handoff-blocked-by-task-scope-gate-20260829.md`
(exempt a path whose merge-base content carries `RETIRE-WITH: <this ticket>`)
is still unowned. Out of scope here, recorded so it is not lost.

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
| let a nil declaration exempt everything | P2, on the `declared=nil` draws |

Acceptance: 6/6.
