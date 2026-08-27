# BL-528 — architect SEND BACK (2026-07-24)

Parcel reviewed: `337b2c6a82` "BL-528: remove superseded extension-side
claim-liveness duplicate" (received from cleaner, `merge_and_process`).

**Verdict: SEND BACK to coder.** The deletion itself is architecturally correct
and I want it kept. But this parcel is the BL-528 parcel — passing it closes
BL-528 — and BL-528's own priority-bump requirement is not implemented.

---

## BLOCKER — the self-perpetuating halt is still live

The ticket's PRIORITY BUMP (2→1, babysitter 2026-07-22T14:24Z) states the
requirement in as many words:

> FIX must also clear/reset the claim-progress sidecar on relaunch (or as part
> of the halt itself), not just gate future increments on activity.

Only the *gating* half shipped. The sidecar is never cleared or reset, by
anything, anywhere:

- `halt-for-claim-progress!` (`swarmforge/scripts/handoffd.bb:898-927`) writes
  the Telegram line, the email, the stop-file, and runs `kill_all_swarm.sh`.
  It never touches `<handoff>.claim-progress.json`.
- No launch/relaunch path clears it. Grep across `*.bb`/`*.sh`/`*.ts` for
  `claim-progress` returns only *readers* (`chase_sweep_lib.bb`,
  `babysitter_assess_lib.bb`) plus the lib itself.
- `remove-sidecars-of!` (`handoff_lib.bb:127`) does delete
  `.claim-progress.json`, but only when the handoff **moves out** of `new/` or
  `in_process/`. In the halt scenario the item never moves — that is the whole
  point of the incident — so this path never fires.

### Why that still re-kills a relaunched swarm

Trace, with a stale sidecar at `reclaims: 10` (= `:halt-threshold`) sitting
beside an item still in `in_process/`:

1. `apply-claim-progress-check!` (`chase_sweep_lib.bb:285`) reads the stale
   sidecar — `reclaims` is carried over verbatim, along with the stale
   `claimAtMs` and `claimCommit`.
2. `evaluate-claim-idle-signal`: the new gates (`:paused-dormant`,
   `resident-shows-work?`, `worktree-dirty?`, `agent-busy?`) each only *skip*
   an observation. On the first observation where none of them fire — an
   idle role with a clean worktree, i.e. exactly the state the halt left
   behind — control reaches `classify-claim-progress`.
3. HEAD is unchanged from `claimCommit`, and `claimAtMs` is stale, so
   `elapsed-ms` is enormous → `:claimed-idle`.
4. The probe branch is skipped: it requires `(zero? reclaims)`, and reclaims is
   10. `idleProbeAtMs` is likewise carried over and long past
   `:probe-grace-ms`. → `:claimed-idle`.
5. `increment-reclaims` → 11. `decide-claim-idle-action` → `:halt`
   (`chase_sweep_lib.bb:336-357`).

So the very **first** ungated idle observation after relaunch halts the swarm
again, skipping the entire nudge→bounce ladder the ticket asks for. The
gating fix narrows *when* an observation counts; it does nothing about the
counter that is already at the threshold when the daemon comes back up. That is
precisely the "4th occurrence" failure the priority bump was filed for: two
consecutive `./swarm` relaunches auto-killed within ~40s, only broken by
manually archiving the sidecars by hand.

`claim-progress-halt-triggered?` (`handoffd.bb:896`) is an in-process atom, so
it resets to `false` on relaunch and provides no protection here.

**Remediation** — either is acceptable, pick one and test it:
- clear the sidecar inside `halt-for-claim-progress!` before
  `kill_all_swarm.sh` (delete it, or rewrite via `make-claim-progress`), or
- reset/ignore any sidecar whose `claimAtMs` predates daemon start, on the
  daemon's first sweep after boot.

Whichever you choose, cover it with a test that asserts a relaunch with
`reclaims >= halt-threshold` on disk does **not** halt on the first sweep.

---

## SECONDARY — the deletion pass missed two more never-wired duplicates

Same rationale as the commit message's own (correct) argument about
double-actuation across the extension-host/substrate boundary:

`extension/src/tools/heartbeat.ts` still exports `isClaimWithoutProgress()`
(lines 125-143) and `isHeartbeatStale()` (lines 100-123), both documented in
their own doc comments as BL-528 auto-heal support ("This helper is intended to
support BL-528-auto-heal-claim-without-progress", "Auto-heal logic elsewhere …
can use this to decide when to release or re-queue a claim").

`grep -rn "isClaimWithoutProgress" extension/src extension/test specs/` returns
**zero** callers outside the declaring file; `isHeartbeatStale` has exactly one,
the `isClaimWithoutProgress` wrapper directly beneath it. They are the same dead
extension-side claim-liveness surface `claimHealer.ts` / `claimLiveness.ts` /
`claimTracker.ts` were, and `heartbeat.ts` is exactly where the co-change report
pointed (it is the one non-deleted file paired with `claimTracker.ts`, from
`94ef96722 feat: add claim tracker and include task in heartbeat payload`).

Remove them in the same pass, or state why they should stay.

## SECONDARY — no acceptance feature for BL-528

The ticket says plainly: "Specifier: write APS feature under
`specs/features/BL-528-*.feature` before coder work." There are 341 feature
files; none matches BL-528, and `grep -rl BL-528 specs/` hits only
`specs/pipeline/steps/bl512RecurringFailureModeAuditSteps.js`. The closing gate
has no acceptance evidence to run. If the feature belongs to the specifier,
raise it rather than let the ticket close without one.

---

## What passed

- **Dependency-rule gate (required hard gate): PASSED**, full-repo scan, no
  forbidden edges. Run after `npm run compile` on the merged tree.
- **Co-change report** on the three deleted files: nothing at or above
  threshold — every reported pair is 1 co-change (default min 3). The pairs are
  the deletion set itself plus `extension/src/tools/heartbeat.ts` ↔
  `claimTracker.ts`, which is what surfaced the secondary finding above.
- **Compile clean; no dangling references** to `claimHealer`, `claimLiveness`,
  or `claimTracker` anywhere in `extension/src`, `extension/test`, or `specs/`.
- **Architecture: the deletion is right.** Chase/nudge/reassign/halt belongs to
  `handoffd.bb`; a parallel TS implementation in the extension host would be
  double-actuation across the tile-as-view / tmux-as-substrate boundary, exactly
  as `chaserMonitor.ts`'s own note warns. Keep this deletion in the rework.
- Superseding the 2026-07-21 `swarmforge/runtime/BL-528-bounce.md` (which told
  the coder to finish the TS route) is a legitimate disposition now that the bb
  implementation shipped — deleting that note is fine.
- **Property testing:** deletion-only parcel; it touched no pure module that
  gained an invariant, so no property test is warranted and none was added.

## Prior-bounce check (BL-340)

Read from the `main` ref, not the worktree. `backlog/evidence/BL-528*` on
`main`: `c38b4e5e8` (false-positive halt evidence, 2026-07-22) and `dc917a1e6`.
The 2026-07-21 runtime bounce note was reviewed above. No previously-bounced
defect is being re-forwarded unfixed by this parcel — the blocker above is the
ticket's own unmet requirement, not a repeat bounce.

By architect.
