# BL-1338 LAND_ESCALATE — facts that change the adjudication — 2026-09-02 ~18:10 UTC

## Context
QA approved BL-1338 at `bc1a587622` (full inventory clean; QA evidence
`BL-1338-land-escalate-20260902.md` in the QA worktree), but
`land_step_cli.bb` returned `LAND_ESCALATE`: "sibling ticket(s) BL-1040,
BL-1056, BL-1271, BL-1283, BL-1317, BL-1319, BL-1321, BL-1326, BL-1327,
BL-1330, BL-1334 unlanded as ancestors … land-step replay: nothing to commit
for BL-1338 - own-paths identical to origin/main". QA correctly did not
force-land, sent the merge-up broadcast, escalated to the specifier
(`002129_from_QA_to_specifier`, queued, specifier is live), and `/clear`ed.
No QA approval parcel has reached the coordinator; BL-1338 stays `active/`
— **not closed**, correctly, because it is not on `main`.

I checked the escalation's premises from durable state. Three of them are
wrong or incomplete in ways that matter.

## 1. Seven of the eleven "unlanded siblings" are CLOSED
`find backlog -name "BL-<id>-*"`:
- done/: BL-1040, BL-1283, BL-1319, BL-1321, BL-1326, BL-1330, BL-1334
- active/ (genuinely in flight): BL-1056, BL-1271, BL-1317
- paused/: BL-1327

Proof the detector mis-classifies replay-landed tickets: each done
sibling's latest QA-branch commit is an ancestor of the approved tip but
NOT an ancestor of `origin/main` (6 of 7; BL-1040's is):
```
BL-1283 526332ff7a NOT-ancestor  | BL-1319 e8ea010e3c NOT-ancestor
BL-1321 c3a81a2cc8 NOT-ancestor  | BL-1326 cb552a4f1a NOT-ancestor
BL-1330 cb552a4f1a NOT-ancestor  | BL-1334 27ce91577a NOT-ancestor
```
Tip-pure replays land CONTENT under new SHAs, so the QA branch's merge
commits for those tickets never become `main` ancestors.
`land_step_lib.bb:104 sibling-landed?` answers from "attributed content
already on main" and, per its own docstring, reports an *unanswered*
attribution as entangled — so every replay-landed done ticket keeps
inflating the set. (Not the BL-1339 store-root mismatch: root and QA
worktree `land-approvals/2026-09.jsonl` are byte-identical — BL-1334 and
BL-1330 records only.)

**Real entanglement is 3 tickets, not 11: BL-1056, BL-1271, BL-1317** (all
mid-pipeline; their tips reached the QA branch through QA's merge-up
broadcasts). BL-1327 (paused) is a fourth ancestor worth a look.

## 2. "own-paths identical to origin/main" is FALSE for BL-1338
On `origin/main`:
- `specs/pipeline/steps/bl1338RoutingStampFingerprintSteps.js` — **absent**
- `specs/pipeline/steps/index.js` — **0** `bl1338` mentions
- the `computeTicketFingerprint` refs in `deprecate-check.ts` are from
  BL-1193/BL-1267 (2026-08-29), not BL-1338's change.
In the approved tip `bc1a587622`: handler file present, registered (1).
So BL-1338's real code is not on main, yet the replay found nothing to
commit. `bc1a587622` is a merge (2 parents); `land_step_lib.bb` attributes
paths by "which commit's first-parent edge carried it" (`:217`) — BL-1338's
tagged commits entered QA's branch on second-parent edges (QA merged the
documenter tip), so nothing was attributed to BL-1338 → empty own-paths →
"nothing to commit". Same family as BL-1297 (merge commits fail open on
first-parent diffs). Landing "siblings first" would NOT fix this; the
replay would still land nothing for BL-1338.

## 3. main is carrying a live `.feature` with NO handler since 15:51
`specs/features/BL-1338-a-routing-stamp-does-not-invalidate-an-adjudication.feature`
(3 scenarios) is on `origin/main` from the **mint** commit `d009f68f66`
(specifier, 15:51 UTC) — a live `.feature`, not `.feature.draft`.
`specs/pipeline/runtime.js:24` `throw new Error(… no step handler matched …)`
on an unmatched step. So the acceptance run on `main` throws for BL-1338's
scenarios until the handler lands — the BL-233 hazard the specifier prompt
itself names, and a new red cause on `main` distinct from the corroborated
standing-red class. (QA's green acceptance was on its own branch, where the
handler exists.)

## What I did / did not do
- Did NOT land, force, or close anything (Article 1.1/1.8, BL-247).
- Sent the specifier a `note` (priority `00`) pointing here, so the
  adjudication is over the real 3-ticket set and the real blocker (path
  attribution on a merge tip), not "land 11 siblings in order".
- Flagged §3 for whoever lands first: landing BL-1338's handler +
  registration is what turns main green for that feature.
- Optimizer recommendation (human/specifier call, not mine to act): this is
  a defect IN the delivery machinery — the expeditor lane
  (`swarmforge/scripts/expedite.sh`) exists for exactly this shape if the
  normal path cannot land its own fix.

By coordinator.
