# INTAKE — mechanize recurring ad hoc LLM verification into tools

Source: human via Claude Code, 2026-09-26: "I think we should have tool
removing llm work wherever it makes sense" and, on how to enforce it,
"this principle should be a core responsibility of the lean coordinator. Or
is there a way to enforce this rule even harder on the swarm engine?"

## What prompted this

QA's BL-1711 land: to build the tip-pure commit it hand-grepped the branch
for which paths actually belonged to BL-1711 (`grep -E 'BL-1711|unowned-...'`)
before trusting the automated keep/drop classification. It worked — BL-1711
landed clean — but it's a safety-net verification QA re-derives from scratch
each session rather than a fixed, reusable procedure, so different QA
sessions can vary in how thoroughly they do it. Same territory as the
BL-1670/BL-1467/BL-1773 land-classification hardening line, but the human's
ask here is broader than that one land step: whenever ANY role is doing a
repeated hand-judgment call that could instead be a deterministic check,
that's a candidate to mechanize.

## Why a prompt-only rule ("coordinator should own this") isn't enough

Making it a standing duty in coordinator.prompt is cheap and worth doing as
a first, soft layer — but it's still an LLM remembering a policy, which is
exactly the class of unreliable, session-variable behavior this principle
is trying to move away from. It should not be the ONLY enforcement.

## What is wanted — a mechanical register, same idiom as the existing ones

This codebase already has two registers built for exactly this shape of
problem: `backlog/standing-reds.tsv` (one row per tolerated red, keyed,
throttles until an owning ticket exists) and
`backlog/hardening-debt-ledger.yaml` (one row per deferred gate, keyed by
parcel+gate+file_set, discharged_at/discharged_evidence when resolved). A
third register in the same family:

- **A recurring-verification ledger** (e.g.
  `backlog/verification-debt-ledger.yaml` or a `.tsv` in the same style).
  Any role appends a row when it hand-verifies/hand-classifies something
  that isn't backed by a script — role, category (e.g.
  "land-keep-drop-path-ownership"), ticket, a short description, detected_at.
- A **mechanical sweep** (a script, not an LLM judgment call — counting
  rows by category is enough) that flags any category appearing at or above
  some threshold (e.g. 3 occurrences) as needing a tool, and gates further
  promotion in that category the way the standing-red register throttles
  on an unowned row — until either a tool ships (row discharged, evidence
  linked, same pattern as hardening-debt-ledger's discharged_at/
  discharged_evidence) or the ticket owner explicitly waives it.
- This makes the rule hold even when no role happens to notice the pattern
  that day — the register does the noticing.

## Concrete seed instance

Category: land-time path-ownership/keep-drop verification (the BL-1711
case above). Whatever role/mechanism first supports the new ledger should
land with this row already recorded, and the specifier should judge
whether the count already crosses the mechanize-it threshold given
BL-1670/BL-1467/BL-1773's prior history in the same category.

## Scope note for the specifier

This is a proposal to disposition, not a spec. FIRM only on: the ledger
must be a register in the existing standing-reds/hardening-debt-ledger
idiom (keyed rows, mechanical sweep, discharge tracking) — not a new LLM
judgment layer, and not folded silently into an existing role's prompt as
the only enforcement. Category taxonomy, threshold value, which daemon or
script runs the sweep, and exact file format are all open (the "How" is
direction, not mandate).

## Disposition (specifier, 2026-09-26)

Split 1:3 (Consolidation Authority, Article 5.3; both human sentences
carried verbatim into every ticket's `source:`):
- **BL-1782**: the ledger `backlog/verification-debt-ledger.yaml`, its
  recorder and reader, and the threshold (default 3) with ownership by
  `verification_category:`. Seeded with the BL-1711 row this intake names,
  plus BL-1748, BL-1764 and BL-1768 (the same day's hand-built lands).
- **BL-1783**: discharge (tool shipped, evidence linked) and waive (with
  who and why), from "What is wanted", second half of bullet 2.
- **BL-1784**: an unowned category throttles intake to 1 the way an
  unowned standing red does, from bullet 2's "gates further promotion".
- The first, soft layer ("core responsibility of the lean coordinator")
  and every role's recording duty are prompt prose, landed in the mint
  commit: coordinator.prompt, every pipeline role prompt,
  specifier.prompt, backlog-schema.md, and
  `swarmforge/constitution/articles/reference/verification-debt-ledger-2026-09-26.md`.
- Seed judgement: `land-path-ownership` is over the threshold on arrival
  (4 rows). Its owner is not minted in this pass. See BL-1782 `notes:`.
