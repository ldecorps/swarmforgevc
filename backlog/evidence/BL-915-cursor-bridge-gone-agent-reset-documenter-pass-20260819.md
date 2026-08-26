# BL-915-swarm-stamp-cursor-bridge-gone-agent-reset — documenter pass — 20260819

Commit reviewed: `77223b0b10` (hardener's forward, `merge_and_process
hardender 77223b0b10`), landing `0c3883fe4a` (coder's certification).

## What changed

This is a BL-848 hotfix stamp-off. The actual behaviour change — folding a
gone-agent fault (`"Agent agent-... not found"`) into
`shouldResetCursorAgentSession` alongside the three pre-existing reset
faults — landed to production in hotfix `ece61cbe63`, outside this
pipeline, before this ticket started. No production file changed in this
parcel (`git show --stat 0c3883fe4a` touches only the new acceptance step
handler and `specs/pipeline/steps/index.js`). This parcel's job is
certifying that already-shipped code through the gate stack: coder added
step handlers for the ticket's live `.feature` file (10/10 scenarios),
architect and hardener verified both invariants non-vacuously in both
directions (over- and under-matching), with the mutation gate itself
blocked by a BL-149 cooldown and CRAP deferred to a quiet host per the
hardener's evidence.

## Doc surfaces checked

- Grepped `docs/` for `telegramCursorBridgeCore`, `shouldResetCursorAgentSession`,
  `session-reset`/`session reset`, `Agent.resume`, `agentId`,
  `active-run conflict`, `auth error`, `connection failure`: no doc
  enumerates the bridge's session-reset fault list at this granularity.
  The only `agentId` mentions (`docs/how-to/BL-696-miniapp-lets-talk-cursor-audio.md`,
  the BL-696 amendment specs) describe the manual "New session" operator
  action clearing `agentId` — a distinct, unaffected feature — not the
  automatic fault-classification this hotfix extended.
- No operator-facing doc claimed or depended on the old failure behaviour
  (prompt fails outright on a gone agentId), so nothing is stale to correct
  now that it transparently resets instead.
- No new human-facing command, setting, or flow — this is a resilience fix
  to an existing internal fault path plus its own gate certification, not
  a new operator-visible feature.
- `docs/diagrams/` — no topology, component, or boundary change; not
  touched.

## Verdict

NONE. No human-facing documentation requires a change for this parcel.

## Forward

`git_handoff` to `QA`, priority `00`, task
`BL-915-swarm-stamp-cursor-bridge-gone-agent-reset`.

By documenter.
