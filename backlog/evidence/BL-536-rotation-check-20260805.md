# BL-536 "architect+hardener stages missing" — rotation-logic check (specifier, 2026-08-05)

Response to QA's note `20260804T224225Z_000026` ("check rotation logic") sent
alongside the BL-536 bounce
(`backlog/evidence/BL-536-provider-auth-error-auto-respawn-bounce-20260805.md`).

## Verdict: rotation logic is exonerated. Both stages ran.

Worktree reflogs (times +0200 local; Z in parens):

```
.worktrees/architect:
12ec1b62 HEAD@{2026-08-04 22:58:30} merge 12ec1b6209: Fast-forward   (20:58:30Z)
.worktrees/hardender:
12ec1b62 HEAD@{2026-08-04 23:12:34} merge 12ec1b6209: Fast-forward   (21:12:34Z)
```

Correlated with the handoff envelopes:

| hop | sent (Z) | merged in role worktree (Z) |
|---|---|---|
| cleaner → architect (`000016`) | 20:45:42 | 20:58:30 (FF) |
| architect → hardender (`000019`) | 21:08:54 | 21:12:34 (FF) |
| hardender → documenter (`000018`) | 21:26:22 | — |

The mono-router resident rotated into each role, merged the received commit,
spent 10–14 minutes in the stage, and forwarded. Nothing in the rotation path
skipped a stage; the daemon's flow-watchdog even WARNed on the parcel aging in
each role's `in_process` while the stage worked.

## The real defect: a clean pass left no durable trace

Both merges were **fast-forwards** — no merge commit — and neither role
committed anything else (no explicit-NONE / pass-evidence file per Article
4.4). Each forwarded **exactly the received hash** (`12ec1b6209`). Result: the
parcel's ancestry at QA carried zero proof that gates 2–3 ran. QA's
ancestry-based audit was sound given the record it had; the record itself was
the defect. A completed clean pass and a skipped stage were indistinguishable,
and the swarm burned a full bounce + re-entry cycle (22:41Z → 23:16Z second
QA arrival) re-running passes that had already happened, plus this
rotation-logic investigation.

Note: QA's D1 evidence also cited `git log --all --grep="BL-536"` returning
zero architect/hardener commits — true at 22:41Z, and exactly the point: a
clean pass that commits nothing is invisible to every audit.

## Disposition

1. **Article 4.4 amended** (this commit): the explicit-NONE inventory of a
   clean pass must be COMMITTED to the reviewing role's branch, and the
   forward must name that commit — never the bare received hash. A stage that
   leaves no commit in the lineage did not happen, as far as any audit can
   tell.
2. **BL-806 specced** (`backlog/paused/`): mechanical gate in
   `swarm_handoff.bb` — refuse a forward-direction `git_handoff` from a
   review role whose `commit` equals the commit that role received for the
   same task. Prompt text alone is the same trusting-the-model failure BL-805
   just closed for rotation.
3. **No rotation ticket**: no defect found in `rotate_to_role` /
   `handoff_lib` rotation for this incident.
4. The severe-load flag in QA's evidence (load avg 254, Article 3.5
   territory) is the coordinator's lane; QA's note was addressed to both.

By specifier.
