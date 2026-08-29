# Paused-pool zombie sweep — third pass, 2026-08-29 (specifier)

## What this is

Eight tickets sat in `backlog/paused/` with a promotable `status:` — several
with `human_approval: approved` — while the work they describe was **already
QA-approved and landed on `main`**. Promoting any of them sends the coder to
rebuild working, hardened, gated code.

Two had already been promoted and the promotion reverted by the BL-1223
dispatch-trail guard (BL-1027 `02e53176e`, BL-1179 `95164a0f2`) — the guard
caught the symptom, but nothing closed the ticket, so each stayed eligible and
simply sank in the priority-sorted pool.

## Why the second pass did not stick

A prior sweep this same day diagnosed this set correctly but **never
committed**: no retirement commits exist for any of the eight, and the
evidence file it claimed to write (`paused-pool-zombie-sweep-20260829.md`) is
absent from the repo. This is the failure mode BL-1258 was filed for —
an adjudication that lives only in a session, or only in `backlog/evidence/`,
is not durable. This pass lands the `git mv` itself, one commit per ticket.

## Evidence per ticket

Each row was verified independently, not taken from the prior sweep's claim.
Every QA sha below was confirmed an ancestor of local `main` with
`git merge-base --is-ancestor <sha> main` (local `main` is 61 ahead of
`origin/main`; the coordinator has not pushed — local is the fresher ref).

| Ticket | QA approval on `main` | Implementation | Registered handler |
|---|---|---|---|
| BL-1027 | `e77ed8d2a5`; closed by `1e2d8ed80`, then resurrected into `paused/` | `swarmforge/scripts/backlog_hygiene_lib.bb`, `promotion_gates_lib.bb` | `bl1027MintTimeDanglingAcceptanceSteps` |
| BL-724 | `d3f7168e9` (QA pass inventory) | `swarmforge/scripts/test/shell_test_discovery_lib.bb`, `shell_test_discovery_cli.bb`, `test_shell_test_discovery.sh` | `bl724OrphanRedShellTestUntrackedAndUndiscoveredSteps` |
| BL-778 | `9603a9c85` (QA pass inventory) | `swarmforge/scripts/test/test_rule_proposal.sh` | `bl778RuleProposalTestAssertsStaleQueueGrammarSteps` |
| BL-1179 | merge-up approved `1b97c26e56` | `extension/src/tools/agentMemoryVendorAdapters.ts` | `bl1179CrossVendorMemoryAdapterSteps` |
| BL-1207 | merge-up approved `2c546a1404` | `isAbandonedAgentLock`, `extension/src/bridge/cursorBridgeAgentSession.ts:168` | `bl1207AbandonedLockLivenessSteps` |
| BL-1211 | merge-up approved `bf302a266e` | `swarmforge/scripts/parcel_rollback_guard_lib.bb`, `extension/src/tools/quarantine-lift-check.ts`, `recovery-filter-check.ts` | `bl1211QuarantineLiftAuthorshipSteps` |
| BL-1228 | approved `cb742b22b` | `swarmforge/scripts/active_pool_freshness_audit.sh`, **called** from `promote_and_route_next.sh:481-482` | `bl1228ActivePoolFreshnessHoldAuditSteps` |
| BL-1230 | merge-up approved `5a4528936d` | `findNestedGitRepositories`, `extension/test/helpers/nestedGitRepoGuard.js` | `bl1230NestedGitRepoGuardSteps` |

## How six of them got back into `paused/`

BL-1179, BL-1207, BL-1211, BL-1228 and BL-1230 (with BL-1222, already correctly
in `done/`) were parked to `hold/` by BL-1248's expedite park and then returned
by the unhold sweep `e5fed8dac` — which moved them `hold/` → `paused/` instead
of `hold/` → `done/`. The park moves the YAML, not the parcel, so delivery
completed underneath the park and the unhold had no way to tell a parked
in-flight ticket from a parked delivered one. BL-1261 (active) owns that
divergence.

BL-724 and BL-778 are a different and simpler cause: QA-passed 2026-08-25 and
2026-08-28 respectively and never closed at all.

## Deliberate keeps — checked and NOT retired

- **BL-1238** — reads like the others (approved, handler-adjacent) but its
  parcel is **live**, bouncing at documenter/QA on entangled-tip defects as
  recently as today (`BL-1238-qa-bounce-20260829.md`). Retiring it would
  discard an in-flight parcel; promoting it would open a second one. Left
  exactly where it is.
- **BL-1222** — same class as the six, but already correctly tracked in
  `backlog/done/`; only a stale duplicate `paused/` copy remained, and that
  deletion was already in flight in the shared `main` working tree. Not
  touched.
- **BL-545** — `type: epic` tracker; its registered handler belongs to a child
  slice, not to the tracker.

## Not retired here: the scenarios

Per the standing rule, retirement retires the **ticket**, not the behaviour.
Every `.feature` file and step handler above stays exactly as it is — the
behaviour is live, the acceptance runner throws on a scenario with no handler,
and deleting them would redden the gate and drop real coverage.

## One open question preserved

BL-724's own notes deliberately leave fault 1 — "should `swarm_handoff.bb`
auto-rotate the mono-router resident on delivery, instead of agents calling
`rotate_to_role.sh` by hand?" — unanswered, because `role_ask.bb` refused to
raise it while another specifier question was pending. That ticket's scope was
fault 2 only and shipped complete. The auto-rotate question is **not** closed by
this retirement and should be raised once the specifier's question slot frees.

By specifier.
