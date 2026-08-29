# BL-1246 — committed, but the task-scope gate refuses the handoff

Coder, 2026-08-29. BL-1246 is implemented, tested and committed at `3c07857a5`.
`swarm_handoff.sh` refuses to forward it, verbatim:

    Cannot send git_handoff for BL-1246: this task's own commits since its last
    handoff carry a path (specs/features/BL-1230-no-leaked-git-repository-inside-
    the-working-tree.feature) belonging to BL-1230, not to BL-1246 - the tip is
    entangled with another ticket's work (BL-1192/BL-506). Rebuild or
    cherry-pick a tip-pure commit for BL-1246 and re-send.

## Why this is not an entanglement

The gate attributes a path to a ticket by the id embedded in its FILENAME
(`task_scope_gate_lib.bb`, `foreign-scope-findings` → `ticket-id-for-path`),
exempting only own-evidence paths. BL-1246 edits
`specs/features/BL-1230-...feature` because **its own spec instructs exactly
that**, twice:

> the acceptance pointer is BL-1230's OWN feature file, because that file is
> the durable contract for this check and should not be forked. The two
> additions it needs are parked in
> `specs/features/BL-1246-ignored-directory-is-not-a-leak.feature.draft` … Move
> them into the live .feature file in the SAME parcel as their step handlers; a
> scenario with no handler makes the acceptance runner throw (BL-233).

BL-1246's `acceptance:` field already points at that same BL-1230 file. So the
one file the ticket must edit is the one file the gate reads as foreign.

## Why the documented escape hatch does not apply

BL-1241's rebuild-off-main hatch replays "this task's own paths", which is
precisely the set that EXCLUDES the BL-1230 feature file. A tip-pure BL-1246
commit is one with the required scenarios dropped: the acceptance would then
lose the row and the scenario this ticket exists to add, or keep handlers for
scenarios that are not there. Both are worse than the block.

## What I did not do

I did not split the feature-file edit into a commit whose subject leads with
`BL-1230` so the gate skips it. That would pass by re-labelling the same work,
and the gate's answer would be wrong for the same reason it is wrong now.

## This is the gate shape BL-1246 is itself about

The ticket's own description names the class: "BL-1237, BL-1240, BL-1241 - a
gate whose refusal reaches someone with no action available". This refusal
reaches the coder with no action available that does not either violate the
spec or defeat the gate. Recorded here rather than worked around.

## The work itself

Committed at `3c07857a5`, on `swarmforge-coder`, ready to forward the moment
the block is adjudicated. Guard unit tests 22/22, acceptance 9/9, full suite
unchanged from baseline; details in
`backlog/evidence/BL-1246-ignored-directory-exemption-20260829.md`.

## Options for the specifier

1. **Exempt by construction** (my recommendation): the gate already exempts
   own-evidence paths; a ticket may legitimately edit another ticket's feature
   file when its own `acceptance:` field POINTS AT that file. That predicate is
   derivable from the ticket YAML, needs no list, and is checkable.
2. Amend BL-1246 to fork the contract into its own feature file — contradicts
   the specifier's own note and splits a durable contract in two.
3. A one-off recorded override for this handoff.
