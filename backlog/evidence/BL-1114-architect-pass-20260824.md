# BL-1114 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner `17efe389d0` (on coder `046358e2ee`) into
`swarmforge-architect`. Merged cleanly; ancestry confirmed.

## Scope

Exhausted dead-letter recovery must not leave silent `*.handoff.dead` debris:

- Terminal note into the holder's `inbox/new` (role-visible dequeue)
- `sendWakeUp` + `setNeedsHuman`
- Move `.dead` (+ recovery sidecar) to `handoffs/failed/`
- Cleaner: one `Date` for stamp + `created_at`
- Corrupt quarantine still shares `*.handoff.dead` / notify surface

## Architecture

- Matches approval: **both** role-visible escalation and post-announce
  disposition of the `.dead` (announce-once alone was insufficient).
- Thin helpers (`installTerminalRecoveryNote`, `disposeEscalatedDeadLetter`,
  `applyExhaustedEscalation`); live recover loop stays a branch table.
- `failed/` is the same box babysitterd already CRIT-watches — no new
  orphan path.
- Host-side swarm util only; no webview/secrets; stamp-off tip hygiene OK
  (`27273f2b0a`, BL-1113 9/9).

## Required hard gate

`node extension/out/tools/dependency-gate.js src/swarm/handoffRecovery.ts
test/bl1114DeadLetterNotSilent.property.test.js` → PASSED.

## Invariants review (BL-633/BL-654) — 2 declared, encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | New `.dead` announced or named refusal | feature scenarios 01–02 + corrupt surface | Green |
| 2 | Exhausted recovery escalates; no silent debris | property + feature + unit | Green |

## Property-testing support (undeclared)

Invariant 2 covered by `bl1114DeadLetterNotSilent.property.test.js` (1/1).
No additional undeclared property authored.

## Correctness read-through

- Unit 15/15; acceptance 4/4; properties 1/1.
- Message header truncated to ≤80 for note limits.
- No prior BL-1114 bounce evidence.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1114-dead-letter-quarantine-must-not-be-silent`, commit = this evidence
commit (BL-536 / BL-806).

By architect.
