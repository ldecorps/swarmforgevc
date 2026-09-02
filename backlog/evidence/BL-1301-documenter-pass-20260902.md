# BL-1301 — documenter pass

Date: 2026-09-02 · Verdict: **doc updates made, forwarding to QA**

## Scope reviewed

BL-1301 makes the dropped-parcel chase sweep (`chase_sweep_lib.bb`'s
`decide-dropped-parcel?`, wired at `handoffd.bb::dropped-parcel-sweep!`)
honour `status: blocked` as a deliberate park: a new `parked-ticket?`
predicate, anchored to exactly `status: blocked` (fail-closed for any other
value or an absent field), suppresses the nudge and logs
`dropped-parcel-suppressed` with the ticket id and reason. The dispatch-gap
and unassigned-active sweeps are untouched (BL-1006 tracks whether they
should also honour the marker). Reviewed coder/architect/hardener evidence
files and the full diff (`chase_sweep_lib.bb`, `handoffd.bb` wiring, feature
file + step handler, property runner, updated test runners).

## Doc impact

This is a genuine behavior change to a documented ticket field
(`status: blocked`), not an internal-only refactor — updated:

- `swarmforge/backlog-schema.md`'s `status` row said "**Only `blocked`
  changes behaviour**" naming just the promotion refusal
  (`promote_and_route_next.sh`'s `is_blocked_status`). That sentence became
  false the moment this ticket lands: `blocked` now changes two behaviours.
  Rewrote the row to describe both, name the anchored-match/fail-closed
  contract, and note the dispatch-gap/unassigned-active sweeps are
  unaffected.
- `docs/reference/Specification.MD` — prepended a new dated entry at the top
  of the running changelog (matching the existing "Prior entry —" chain
  format) describing the fix, the live BL-1295 instance that prompted it,
  and the fail-closed/logged-suppression contract. "Last Updated" bumped to
  September 2, 2026 in the same commit as the content change.

Checked and NOT touched:

- No diagram change-trigger fired: `architecture.mmd`'s `.swarmforge/`
  state-layout and tmux-substrate triggers don't cover a sweep's internal
  decision predicate, and `swarm-flow.mmd`'s pipeline-topology/backlog-flow
  trigger doesn't either — this is a refinement of an existing sweep, not a
  new mechanism or a topology change.
- No dedicated how-to exists for the BL-719 dropped-parcel sweep to amend;
  grepped `docs/how-to/` for `BL-719`/`dropped-parcel`, only an unrelated
  tangential hit in `BL-891-master-main-reconcile-sweep.md`.
- No retirement: nothing moved to `docs/deprecated/`.

## Verdict

Doc updates made and committed. Forwarding to QA.

By documenter.
