# BL-1338 — cleaner pass (20260902)

Received: coder commit `69ae1c2ee3` (BL-1338: exclude the promotion's
routing stamp from the adjudication fingerprint), merged into cleaner as
`1a0305ca78`.

## Checklist run

- Compiled TypeScript (`npm run compile`) — clean.
- `extension/test/deprecateAdjudication.test.js` — 19/19 pass (includes the
  6 BL-1338 cases: stamp-invariance, re-routing invariance, substantive-edit
  re-arm x3 variants, promoted-ticket discharge, post-clearance amendment
  hold).
- Full deprecate-check surface: `deprecate.test.js`,
  `deprecateIdentifyUnused.test.js`, `deprecateCheck.test.js`,
  `deprecateAdjudication.test.js`, `deprecateRetiredReferents.test.js` —
  79/79 pass, no regression from the fingerprint change.
- `npm run test:properties -- deprecateRoutingStampFingerprint` — 2/2 pass:
  invariant 2 (routing stamp never changes the fingerprint, 300 runs) and
  invariant 1 (a substantive amendment always changes it regardless of
  stamp state, 300 runs).
- Mutation-site count (BL-485) on the one changed production file:
  `extension/src/tools/deprecate-check.ts` → 750 sites, `over` the 100
  threshold. Confirmed via the parent commit
  (`69ae1c2ee3^:extension/src/tools/deprecate-check.ts`, 852 lines) that
  this file was already far over threshold before this ticket — the parcel
  adds ~29 lines to an existing large module, not new bulk. A split now
  would be unrelated churn against a `severity: low`, narrowly-scoped
  defect fix whose own `out_of_scope` explicitly excludes touching anything
  beyond the fingerprint computation; the module stays cohesive (one
  concern: deprecation/freshness checking) and a mechanical carve-out here
  would not improve structure. Advisory noted, no split taken (BL-485: "a
  legitimately-cohesive large module that a split would only harm stays
  whole").
- `jscpd` over `src/`: 76 pre-existing clones repo-wide, none touching
  `deprecate-check.ts` or any BL-1338 file. No duplication introduced.
- Architecture: `fingerprintableTicketText` is a pure, side-effect-free
  string transform kept next to `computeTicketFingerprint`; no IO, no new
  module boundary crossed, no policy leaked into callers
  (`deprecate-check.js`, `record-adjudication.js` unchanged, still call
  through the same exported function).
- Confirmed the ticket's own invariants are asserted, not just implied: the
  "byte-exact re-arm on a substantive edit" invariant has a dedicated
  whitespace-only property case (`t + '\n'`), and the "indented assigned_to
  inside a block scalar is spec text" edge case is a direct unit test.

## Verdict

No defect found in cleaner's domain (coverage, CRAP-adjacent complexity,
DRY, module structure/boundaries). Clean sweep — forward unchanged.

By cleaner.
