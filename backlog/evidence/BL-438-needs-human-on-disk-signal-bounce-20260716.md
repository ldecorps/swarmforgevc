# BL-438 QA bounce — 2026-07-16

## Verdict: BOUNCE — documenter shipped the pre-architect-bounce code (BL-368 pattern repeats)

## What happened, by commit graph

In the hardener worktree, at `2026-07-16 04:46:02`, the hardener committed
`6c835e8b` ("BL-440/BL-438 hardening: cover the real appendToReplyOutbox
writer and malformed chase-escalations.json") **before** merging in the
architect's actual BL-438 review commit. One minute later, at `04:47:37`,
the hardener created `adc9177a` ("Merge architect BL-438-needs-human-on-disk-signal
(7af2f29ea9) into hardender") — a merge whose first parent is `6c835e8b` and
second parent is `7af2f29e` (architect's BL-438 merge). That architect
commit's own code comments say explicitly: `needs_human (swarm-wide,
architect bounce 2026-07-16) is the coordinator's OWN blocked-on-a-human
state ... never chase-escalations` — i.e. the architect had already bounced
an earlier, wrong design (needs_human derived from chase-escalations.json)
and the fix landed in `7af2f29e`/`adc9177a`.

Five seconds after `adc9177a` was created, the documenter committed
`089bd710d7` ("Document BL-438: fleet console needs_human/isBlocked sources
the real signal") — **but its only parent is `6c835e8b`, not `adc9177a`**.
The documenter never merged the hardener's actual final commit; it committed
directly on top of the hardener's pre-merge intermediate state, so the
architect's fix never made it into the commit handed to QA.

Confirmed by ancestry check:

```
git merge-base --is-ancestor adc9177a 089bd710d7   # => no
git merge-base --is-ancestor 7af2f29e 089bd710d7    # => no
```

And confirmed by content: `git show 089bd710d7:extension/src/tools/emit-fleet-status.ts`
still exports `needsHumanFromEscalations` (deriving `needs_human` from
`.swarmforge/daemon/chase-escalations.json`, the PACK-ROLE stuck-mailbox
signal, which `compositeNode.ts` itself documents as structurally excluding
the coordinator) — not the architect-approved `needsHumanFromAwaitingAnswer`
(deriving it from `.swarmforge/operator/awaiting-answer.json`, the
coordinator's real ask+await state, per BL-438's own ticket text: "the
coordinator / needs-human reconciler is the only thing that knows 'I'm
waiting on a human'").

This is the same class of defect this repo has already named once before:
commit `642d95b9` — "BL-368 QA bounce evidence: documenter dropped
hardener's merge, shipping pre-fix control-loss code under post-fix docs."

## Evidence (BL-140 contract)

1. **Failing command** — a repro against the real compiled
   `buildFleetStatusDoc` (same function `emit-fleet-status.js` uses), run
   from a detached worktree checked out at the commit under review:

   ```sh
   git worktree add --detach /tmp/bl438-repro 089bd710d7
   cd /tmp/bl438-repro/extension && npm run compile

   # Fixture: coordinator IS blocked waiting on a human
   # (.swarmforge/operator/awaiting-answer.json present), and NO pack role
   # is chase-escalated (no .swarmforge/daemon/chase-escalations.json entry) —
   # i.e. exactly BL-438 acceptance scenario 1's premise.
   mkdir -p /tmp/bl438-fixture/.swarmforge/operator /tmp/bl438-fixture/swarmforge
   echo 'config swarm_name fes' >> /tmp/bl438-fixture/swarmforge/swarmforge.conf
   printf 'coder\ttask\n' > /tmp/bl438-fixture/.swarmforge/roles.tsv
   cat > /tmp/bl438-fixture/.swarmforge/operator/awaiting-answer.json <<'EOF'
   {"question":"q","thread_id":"SUP-1","asked_at_ms":0}
   EOF

   node -e "
   const { buildFleetStatusDoc } = require('/tmp/bl438-repro/extension/out/tools/emit-fleet-status.js');
   console.log(JSON.stringify({ needs_human: buildFleetStatusDoc('/tmp/bl438-fixture', 0).needs_human }));
   "
   ```

2. **Commit hash checked out and tested**: `089bd710d7` (documenter's
   handoff to QA, task `BL-438-needs-human-on-disk-signal`).

3. **First error excerpt** — no thrown error; the signal silently fails to
   fire for the ticket's own primary scenario:

   ```json
   { "needs_human": false }
   ```

4. **Failure class**: `behavior`. Compiles clean, unit tests for the
   shipped (wrong) implementation presumably pass on their own terms — the
   shipped design itself is not what the architect approved.

5. **Expected vs observed**: Expected — per acceptance scenario 1 ("Given
   the coordinator is blocked waiting on a human answer ... an on-disk
   needs-human signal is written [and status.json reports needs-human
   true]") and per the architect-approved fix already sitting in `adc9177a`/
   `7af2f29e` — `needs_human` reflects the coordinator's own
   `awaiting-answer.json` ask+await state. Observed — `089bd710d7` still
   ships `needsHumanFromEscalations`, which reads only
   `chase-escalations.json` (a per-pack-role stuck-mailbox signal that
   `compositeNode.ts`'s own header comment says structurally excludes the
   coordinator), so a coordinator genuinely blocked on a human with no
   pack-role chase-escalated in flight reports `needs_human: false` — the
   exact inverse of the ticket's own scenario 1.

## Remediation direction (not prescriptive)

The hardener/documenter handoff needs to carry the hardener's actual final
commit (`adc9177a`, which already contains the architect-approved fix) —
not an intermediate commit the hardener passed through before merging the
architect's review in. Re-send from a commit where
`git merge-base --is-ancestor 7af2f29e <commit>` holds.

By QA.
