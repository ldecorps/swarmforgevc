# BL-1115 — architect bounce (Article 4.4 inventory) — 20260825

Reviewed cleaner tip `b862c936bf` (coder stamp `48ed53f75b` + cherry-pick
`bcba05b8ec` of hotfix `a3bf11b533`) merged into `swarmforge-architect`.

## Scope under review

- `swarmforge/scripts/main_sync_status_cli.bb` (hotfix blob — matches `a3bf11b533`)
- `specs/features/BL-1115-swarm-stamp-main-sync-status-cli-ahead-behind-swap.feature`
- `specs/pipeline/steps/bl1115MainSyncStatusCliStampOffSteps.js` + `index.js` wiring
- evidence: coder stamp + cleaner pass

Tip purity vs `origin/main` on cleaner tip: BL-1115-only (8 paths). Hitchhike
gate CLEAN on received tip.

## Architecture — PASS

Stamp-off harness drives the REAL CLI; no webview/storage; no extension-host
spawn bypass; integrate-not-fork. Cherry-pick preserves hotfix blob identity
(`git diff --quiet a3bf11b533:…/main_sync_status_cli.bb HEAD:…` — MATCH).

## Dependency-rule gate (hard)

Parcel has no extension `src/`/`media/` surfaces. Full-repo / scoped cruise
still surfaces standing `acyclic` cycle
`telegram-front-desk-bot` ↔ `telegramCursorOperator{Exec,Liveness}` —
already **BL-759** (`backlog/paused/BL-759-…`, grepped this pass). Not
introduced by this parcel; not a bounce item.

## Co-change — advisory

`index.js` registry habit + `main_sync_status_cli.bb` co-travels with
handoffd / reconcile (expected). No send-back from coupling alone.

## Acceptance / correctness read

`node specs/pipeline/cli.js specs/features/BL-1115-…feature` → **7/7 PASS**.
No behavioural defect spotted in the CLI binding or APS fixture matrix.

## Inventory

### D1 — `invariant-unencoded` (blame: coder)

Ticket declares two invariants (same shape as BL-1113):

1. Stamp-off never reimplements the hotfix — confirms/refutes `a3bf11b533` only.
2. Green tests alone never write certified/waived into the hotfix ledger.

**Missing:** `extension/test/bl1115*.property.test.js` (or equivalent) runnable
via `npm run test:properties`. No non-encodability reason stated on the ticket
or in coder evidence.

APS Gherkin embeds a one-shot `git diff --quiet` blob check and never writes
the ledger — that is example coverage, not the declared-invariant property
encoding required by BL-633/BL-654 / coder.prompt Invariants. Precedent:
`extension/test/bl1113CursorHotfixStampOff.property.test.js` encodes both
invariants with fast-check + non-vacuity notes.

**Remediation:** Author a non-vacuous property suite that (1) asserts
`main_sync_status_cli.bb` blob identity with `a3bf11b533` across draws, and
(2) asserts the ledger row for `a3bf11b533` stays non-certified / non-waived
(`human_decision: null`, state not certified/waived). Show RED when
deliberately broken, then restore. Do not reimplement the hotfix.

### Property-testing support (undeclared) — BLOCKED BY D1

No additional undeclared pure TS module in this parcel. Declared-invariant
encoding must land first.

## Findings summary

| Item | Class | Blamed | Action |
|------|-------|--------|--------|
| D1 | invariant-unencoded | coder | bounce |

No architecture violation. No correctness defect beyond missing encoding.
Standing dep cycle = BL-759 (report only).

## Forward

`git_handoff` to `coder`, priority `00` — do **not** forward to hardender.

By architect.
