# BL-1338 land LAND_ESCALATE — 2026-09-02

## Verification result
BL-1338 (routing-stamp fingerprint exclusion) fully PASSES QA:
- `npm run compile` clean.
- `test/deprecateAdjudication.test.js` — 20/20 pass.
- `test/deprecateRoutingStampFingerprint.property.test.js` — 2/2 pass (unit and property lanes).
- Acceptance (`specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1338-a-routing-stamp-does-not-invalidate-an-adjudication.feature`)
  — 5/5 pass.
- `specs/pipeline/steps/index.js` registers `bl1338RoutingStampFingerprintSteps`
  (line 18) — wired.
- Wiring confirmed at both real callers: `promote_and_route_next.sh` invokes
  `deprecate-check.js` (which now calls `computeTicketFingerprint` via
  `fingerprintableTicketText`), and `record-adjudication.ts` imports
  `computeTicketFingerprint` from the same module.
- Full unit (`npm run test`) and property (`npm run test:properties`) suites
  run: 15 unit files / 24 property files failed, none touching BL-1338's diff
  (`extension/src/tools/deprecate-check.ts`, `effortDialAdapt.ts`, and their
  own tests). Cross-checked failure signatures against
  `backlog/evidence/QA-standing-red-corroboration-20260828.md` and
  `backlog/paused/BL-1221-...yaml` / `BL-1220`/`BL-1206` — all match the
  already-corroborated standing-red class (`deps.checkOrphanedAuthoredDocs is
  not a function`, `node:test` collection gaps, repo-hygiene guards). Not
  new, not this ticket's.
- Ancestry check: `git merge-base --is-ancestor a3be013e93 bc1a587622` — this
  ticket's own hardener merge is an ancestor of the commit being approved.

**Approved commit**: `bc1a587622dfa6906c1c2a8c2f222bca83b8be89`
(QA merge of documenter `244a76fa6c`).

## Why it cannot land as approved (BL-1241)

`bb swarmforge/scripts/land_step_cli.bb
BL-1338-a-routing-stamp-does-not-invalidate-an-adjudication bc1a587622`
returns `LAND_ESCALATE`:

```
BL-1338-a-routing-stamp-does-not-invalidate-an-adjudication: entangled tip -
sibling ticket(s) BL-1040,BL-1056,BL-1271,BL-1283,BL-1317,BL-1319,BL-1321,
BL-1326,BL-1327,BL-1330,BL-1334 unlanded as ancestors, tip-pure replay could
not complete cleanly; specifier adjudication needed.
land-step replay: nothing to commit for BL-1338 - own-paths identical to
origin/main
```

Re-ran once (bounded, per BL-1144/BL-1241 discipline) after `git fetch origin
main` — identical result both times; `origin-advanced-since-gate: false`, so
this is not a race against origin moving, it is genuine ancestry entanglement
across the QA worktree's long-lived branch.

**Entangled sibling tickets (unlanded, ancestors of `bc1a587622`), named per
the ENTANGLED_SIBLING contract:**
BL-1040, BL-1056, BL-1271, BL-1283, BL-1317, BL-1319, BL-1321, BL-1326,
BL-1327, BL-1330, BL-1334.

Of these, BL-1271 is known to me directly: it is currently bounced back to
`cleaner` (own evidence `backlog/evidence/BL-1271-qa-bounce-20260902.md`,
commit `991ec6ead8`) for an invariant-2 violation, not yet re-fixed — so it is
not landable on its own right now, and precondition 1 (land already-approved
siblings first) does not clear the set. The remaining ten I have not
independently verified; their disposition is unknown to QA from this vantage
point.

## Requested from specifier

Per Article 1.8/BL-1241 point 3, this is not a bounce to any pipeline role —
none of them can remove commits that are ancestors of their own branch. I am
not landing `bc1a587622` and not moving BL-1338 to done until this resolves.
Please adjudicate: either land the entangled siblings in dependency order
first (once each is itself landable), or direct another remedy for the QA
worktree's branch entanglement.
