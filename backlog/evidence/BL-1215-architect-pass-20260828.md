# BL-1215 — architect pass, 2026-08-28

Commit reviewed: fe2d0a9a3d (cleaner, verifying coder work 86cded2bc).

## Architecture
`checkOriginLanding` is wired exactly where the ticket requires: right
after `landedCommit` is captured, before `moveTicketToDone`/`writeReceipt`
run. Fails CLOSED by construction —
`OriginMainLandingCheckOutcome = { reachable: true } | { reachable: false; reason: string }`
has no third "not checked" branch at the type level, unlike the
deliberately-fails-open `CommitClaimsCheckOutcome` sibling. `checkOriginMainLanding`
is an injected seam (`PilotAcceptanceGateDeps`), no real network in unit
tests. Dependency gate: PASSED.

## required_wiring
`pilotAcceptanceGate.ts::origin/main` — confirmed: `checkOriginLanding`
calls `deps.checkOriginMainLanding(commit)` and gates the move on it.

## Invariants (declared)
1. "A piloted ticket reaches backlog/done/ only when its implementation
   commit is reachable from origin/main." — Encoded and verified with
   REAL git fixtures (not mocks) in `pilotAcceptanceGateCli.test.js`:
   `checkOriginMainLanding reports reachable for a commit already pushed`,
   `... refuses for a commit that exists only locally, never pushed`, plus
   the acceptance feature's scenarios 1/2.
2. "An origin/main that cannot be read is treated as not-landed, never as
   landed." — `checkOriginMainLanding refuses ... when origin cannot be
   read at all - no remote configured` (real git, no remote), plus
   acceptance scenario 3.

## qa_e2e_procedure step 4 (BL-729 unaffected)
`checkCommitClaims` tests (fails-open path) unchanged and still pass —
confirmed this ticket did not touch or weaken that sibling check.

## Out-of-parcel finding: pre-existing, unticketed (note filed, not a bounce)
Verified the coder's own commit-message claim: `pilotAcceptanceGate.test.js`
and 8 sibling test files' hand-built `mkDeps()` fixtures crash with
`deps.checkOrphanedAuthoredDocs is not a function` — **confirmed genuinely
pre-existing**, not introduced by this commit: `git log -S
checkOrphanedAuthoredDocs` shows that interface key was added many commits
before BL-1215 touched this file at all. **Grepped the backlog
(paused/active/hold/done) for `checkOrphanedAuthoredDocs` and
`pilotAcceptanceGate.test.js` — genuinely no existing ticket owns this
specific symptom** (BL-1209, the only related-looking ticket, is a
DIFFERENT symptom — `rawMkdtempGuard` module resolution against the
fixture root, not this key). Filed as a `note` to specifier + coordinator
(priority 00) per Article 4.4's spec-gap/untracked-defect routing — not a
bounce, since it does not affect this parcel's own new logic
(`pilotAcceptanceGate.test.js` received only the required 1-line
`checkOriginMainLanding: () => ({reachable:true})` default and no new
assertions of its own; all of BL-1215's real new coverage lives in
`pilotAcceptanceGateCli.test.js`, which runs cleanly).

## Verification run
- `npm run compile`: clean.
- `pilotAcceptanceGateCli.test.js` (vitest): 31/32 pass — the 1 failure is
  BL-1209's own pre-existing, already-ticketed symptom (`rawMkdtempGuard`
  resolution), unrelated to this ticket.
- BL-1215 acceptance feature: 3/3 pass.
- Dependency gate: PASSED.

NONE outstanding for architecture. Forwarding to hardener.

By architect.
