# Answer: the Art Director's standing landing path is B - QA lands on the art director's note

Pending specifier question (asked 2026-09-06T01:19Z, `asked_at_ms`
1788653963621), raised while minting BL-1442 from the Art Director's first
brief: `primary/art-director` (briefs, artifact inventory, design system,
sign-off evidence) had no path to `main` - QA lands parcels only, the
merge-up broadcast excludes the role, and it is not master-resident.
BL-1442 merges the first tip `98e0a7e817` in-parcel as a one-off. Three
standing paths were posed:

- A: each brief's spawned parcel merges the art director's tip.
- B: the art director sends QA a note naming its tip and QA lands it, with
  a docs-only guard (recommended).
- C: the art director becomes master-resident and commits on main
  directly, docs/design only, behind a pre-commit guard.

Human, 2026-09-06, typed into the specifier's own pane, verbatim:

> B: QA lands on AD note (recommended)

Minted as BL-1444 the same pass; prose halves (Article 1.10, PIPELINE.md
row, QA.prompt, art-director.prompt, reference amendment section 5) landed
with the mint.

The answer arrived in the pane, not through the front-desk bot, so
`deliver-role-answer.js` had nothing to pair (`already-consumed` names the
2026-08-28 answer); the slot was released with `role_ask.bb --resolve`
citing this file (BL-1245 route).
