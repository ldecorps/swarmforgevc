# BL-1193 — the retired-token extractor now names what the marker retires

Coder, 2026-08-29.

## Before / after over the LIVE docs tree

    $ node -e "loadRetiredTokens('<repo>')"
    before: ["backlog_hygiene_lib.bb", "Mint", "All", "Expedite"]
    after:  ["type: bug"]

Four tokens, none of them the retired item, replaced by the one token the
marker actually names. `Mint` is this project's own everyday vocabulary
("mint a ticket", "Mint-time gate"), and the Article 3.6 gate runs fail-closed
before EVERY promotion — so that one word held BL-1190, BL-1193 and BL-1206.

The other three are the same defect in other costumes: `All` came from
"- **All** `depends_on` are done, but the description still names **RETIRED**"
(a line describing the gate), `Expedite` from a docs/index.md link title, and
`backlog_hygiene_lib.bb` from the first table column of the very row whose
marker names `type: bug`.

## qa_e2e procedure

    $ node extension/out/tools/deprecate-check.js . BL-1190
    { "decision": "allow" }

Previously `hold — … still names retired surface(s): Mint`. That is the
ticket's headline observable and it is discharged.

The fixture side of the procedure ("a ticket whose description genuinely names
`type: bug` still holds with a reason naming `type: bug`") is covered by three
unit tests over a fixture root and by acceptance scenario 01's second row.

## How the anchoring works

A marker yields a referent only when the line actually predicates a
retirement, in one of three shapes, and the referent is taken ADJACENT to the
marker rather than from the far end of the line:

| shape | example | referent |
|---|---|---|
| mapping | `` `type: bug` → `RETIRED-TICKET-TYPE …` `` | `type: bug` |
| predication | ``the `swarm_old_lib.bb` helper was RETIRED`` | `swarm_old_lib.bb` |
| announcement | `RETIRED: legacy-verb` | `legacy-verb` |

Prose that merely uses the word — "the description still names **RETIRED**
behaviour", "mint `RETIRED-TICKET-TYPE`" — names nothing and yields nothing,
which is the honest answer for a line that retires nothing.

Backticks win over bare words, because the docs quote what they name. A bare
token is accepted only if it could plausibly BE a surface (contains `_`, `.`,
`-` or `/`, or is 8+ characters) and is not a connective — accepting a short
ordinary English word is precisely how "Mint" became a retired token.

## Two tickets still hold, correctly, for a different reason

BL-1193 and BL-1206 still answer `hold`, but the reason changed from
`backlog_hygiene_lib.bb, Mint` to `type: bug` — and both of them genuinely
contain the string `type: bug`, because they quote it while describing the
defect. That is the contract this ticket's own acceptance specifies (scenario
01 row 2: a description naming `type: bug` holds), so it is the correct
behaviour, not a leftover false positive.

Worth the specifier's eye separately: that is the co-occurrence-is-not-subject
shape one level up — a ticket NARRATING a retirement rather than depending on
one. BL-1268 fixed exactly that for the sibling superseded-claim branch (a
ticket citing another ticket's disposition no longer holds). The
retired-surface branch still does a bare `yamlText.includes(token)`. Out of
scope here — this ticket's scenarios pin the current behaviour — but it is the
third sighting of the same shape, which the ticket's own notes asked not to
let happen again.

## Not regressed

BL-1173's true-positive scenario `freshness-hold-retired-surface-02` passes
(its fixture ticket carries the word RETIRED in its own text and holds on the
`depends_on done + RETIRED in ticket text` branch, which is untouched). The
sibling features that drive the same CLI are green: BL-1173 5/5, BL-1267
10/10, BL-1268 7/7.

## Tests

Unit 9/9 (`deprecateRetiredReferents.test.js`), acceptance 3/3, full unit suite
unchanged from baseline (20 files, 33 tests).

The declared invariant is encoded in
`extension/test/deprecateRetiredReferents.property.test.js`: every generated
doc line CONSTRUCTS the distance the defect lives in — a decoy word and a decoy
path always sit earlier on the line than the real referent, exactly as the live
table row does — and the assertion is two-sided (the referent is returned, the
decoys are not), with asserted reachability floors on all three marker shapes.
A generator without decoys would be vacuous: an extractor returning the first
word would pass every line.

Non-vacuity, shown and restored: reinstating the old
`/\b([a-z][a-z0-9_-]{2,})\b.*\bRETIRED\b/i` extractor fails 4 unit tests, both
properties, and all 3 acceptance scenarios.

## Step-handler scoping

`bl1193RetiredTokenAnchoredSteps.js` registers through `defineScoped` from the
start. Its step texts are shared verbatim with BL-1267's and BL-1268's features
(all three drive the same CLI), and an unscoped registration would have
answered their scenarios with this ticket's fixture — the defect recorded in
`backlog/evidence/coder-unscoped-step-collisions-20260829.md` earlier today.
