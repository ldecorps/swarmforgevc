# BL-1189 bounced content removed from cleaner branch (2026-08-28)

## Context

Architect note (priority 00, broadcast to coder/cleaner/hardener/documenter/
QA/specifier/coordinator): "Caveat to my last note: BL-1189 content is
bounced - don't restore, see BL-1211".

BL-1211 documents that BL-1189's coder work was bounced and reverted
(`1fcd4c167`, BL-490/BL-495), then accidentally resurrected during an
unrelated tree-collapse recovery (`0bf05774a` restoring 13 files from
`swarmforge-hardender`). A prior cleaner session on this branch (recorded
in `backlog/evidence/BL-1188-1189-cleaner-merge-recovery-20260828.md`)
treated that resurrection as legitimate dropped work and restored it
forward — which was itself the resurrection bug BL-1211 describes, not a
correct recovery.

## What I found on this branch just now

- `extension/src/bridge/residentPaneLive.ts` and
  `extension/src/concierge/residentPaneSpy.ts` no longer contained the
  BL-1189 additions (`dedupePrimaryWorkingTicket`, `isTicketActive`) —
  the BL-592 QA merge-up already carried the correctly-reverted source.
- But two orphaned files survived, each `require`/importing
  `dedupePrimaryWorkingTicket` from `../out/concierge/residentPaneSpy`,
  which no longer exports it:
  - `specs/pipeline/steps/bl1189LiveScreenOnePrimaryWorkingTicketSteps.js`
  - `extension/test/bl1189LiveScreenOnePrimaryWorkingTicketInvariants.property.test.js`
  - plus the stray `require('./bl1189LiveScreenOnePrimaryWorkingTicketSteps')`
    line in `specs/pipeline/steps/index.js` (also deduped a repeated
    `bl592SpecTreeOnLiveConsoleWithEpicTierSteps` require picked up from
    an earlier conflict resolution in the same session).

## What I did

- Deleted both orphaned files (dead code referencing a reverted export;
  would throw at require-time if ever exercised).
- Removed the `bl1189...Steps` require from `specs/pipeline/steps/index.js`,
  plus two pre-existing, unrelated duplicate requires found in the same
  file while deduping (`bl592SpecTreeOnLiveConsoleWithEpicTierSteps` was
  required twice — once at its original chronological spot, once again
  near the tail from an earlier merge conflict resolution this session;
  `bl718BubbleTalkMirrorSteps`/`bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps`
  were each required twice, unrelated to BL-1189/BL-592, pure DRY cleanup).
- Left `specs/features/BL-1189-live-screen-one-primary-working-ticket.feature`
  and `backlog/active/BL-1189-*.yaml` untouched — the spec is still valid,
  the ticket is still active, and re-implementing it correctly is the
  coder's work, not cleaner's to touch.

## Git-history recovery note

The first attempt to commit this cleanup triggered
`check_property_suite_drift.sh` (staged deletion of a `*.property.test.js`
file matches its trigger glob), which ran `npm run test:properties` and hit
the known, already-ticketed hazard "property suite full run hijacks role
branch refs" (BL-1202/1200) — the `swarmforge-cleaner` branch ref was walked
forward through ~46 fixture-seed commits, orphaning my just-made merge
commit (`9c8bbd703`) without touching its object (confirmed intact via
`git cat-file -t`). Recovered with `git reset --hard 9c8bbd703` (safe: this
is my own branch, the object was never lost, only the ref had moved) and
redid this cleanup pass. Recommitted with
`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` per the guard's own documented
recovery-only override, to avoid re-triggering the same known-corrupting
suite run for a commit that only deletes/dedupes non-source step-registry
plumbing (verified above via targeted vitest + acceptance runs instead).

## Verification

- `npm run compile` — clean.
- `residentPaneLive.test.js`, `residentPaneSpy.test.js` — 35/35 pass.
- `node -e "require('./specs/pipeline/steps/index.js')"` — loads without error.
- `node specs/pipeline/cli.js specs/features/BL-592-spec-tree-on-live-console-with-epic-tier.feature` — 8/8 pass.
- `grep -rn "dedupePrimaryWorkingTicket\|bl1189LiveScreenOnePrimaryWorkingTicket"` across the repo (excluding node_modules/.git/out) — no remaining references.

## Correction (same session, later merge-up for BL-1199)

The subsequent QA merge-up (`b8a11849f8`, BL-1199) carries a **specifier
ruling** (`0e810b458`, `backlog/evidence/BL-1189-specifier-ruling-
resurrected-property-test-20260828.md`) that **lifts the BL-1189 hold** and
**ratifies** the property test and step handler this evidence file
describes deleting — it supersedes the architect's caveat note this
cleanup acted on. The ruling's finding: the byte-identical reinstatement
was a deliberate, architect-reviewed re-fix (`739ca994e`), not an
unauthorized resurrection; BL-1211's own discriminator was amended from
"identical content refuses" to "unauthorized content refuses" specifically
because this case falsified the former.

This does **not** mean my deletion left the branch wrong: QA's own BL-1199
pass note (`963f57e38`, folded into the same merge tip, written concurrently
with — not after — the ruling) independently confirms
`dedupePrimaryWorkingTicket` still has 0 hits in source on QA's line
("BL-1189 correctly still held"), and `git grep` across the full `b8a11849f`
tree finds zero source/step/property-test files for BL-1189 — only
evidence-file prose. QA's current authoritative tip carries **no** BL-1189
implementation content at all (neither source nor tests); the ruling's
instruction was for documenter to re-forward the full ticket, which had not
yet reached QA as of this tip. So this branch, carrying none of it either,
still matches QA's current line — just no longer for the reason ("bounced,
don't restore") originally recorded above. Restoring only the test/step
files here (without the source they call) would have reintroduced the
exact orphaned-require breakage this evidence file fixed. Left as-is;
BL-1189's real re-forward is presumably in flight elsewhere in the
pipeline, not cleaner's to chase.

By cleaner.
