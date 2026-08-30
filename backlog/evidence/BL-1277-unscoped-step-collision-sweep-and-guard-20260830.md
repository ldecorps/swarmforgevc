# BL-1277 — the sweep and the guard

Coder, 2026-08-30. Companion to `BL-1277-coder-unscoped-step-collisions-20260829.md`,
which is the diagnosis; this is what was built.

## What shipped

1. **A guard**, `extension/test/helpers/stepCollisionGuard.js`, driven by the
   unit lane (`extension/test/bl1277UnscopedStepCollisionGuard.test.js`), the
   property lane, and the BL-1277 acceptance step handlers — one enumeration,
   one verdict path.
2. **The sweep**: 16 registrations across 16 step files pinned to their own
   feature with `registry.defineScoped` (through a local `bl1277Scoped`
   helper, the idiom `205fdd36f` used). No handler logic and no `.feature`
   file changed.
3. `specs/pipeline/stepRegistry.js` gained `listDefinitions()` — a read-only
   view of what was registered. `resolve()` is untouched, as the ticket's last
   constraint requires.

## The guard's verdict is the registry's, not a source scan (invariant 2)

Each step file is loaded and asked to register into a fresh
`createStepRegistry()`; the collision set comes from `listDefinitions()`.
Nothing greps for `registry.define`. That is not decoration: several shipped
files register through a local wrapper or a loop, and after this parcel
sixteen more do, so a source scan and the registry now disagree by
construction.

The file list comes from the module system's own parent/child record for
`steps/index.js`, not a directory glob. A glob also sweeps up the `*Only.js`
focused entry points, each re-exporting another file's `registerSteps`; those
would read as a second file registering every one of that file's patterns and
the guard would refuse a clean repository.

The shipped-repository verdict is computed in a CHILD process (the BL-968
posture). Loading ~800 step files pulls in whatever they pull in — several
reach `node:test`, which prints TAP and can derail a vitest worker — and a
guard must not break the lane it runs in. The verdict is found in the child's
stdout by MARKER, never as "the last line": `node:test` flushes its own report
at exit and would otherwise be parsed as the answer.

## The sweep, and what it actually changed

The scan was re-run at implementation time rather than trusting the count in
the ticket. In this worktree it found **10** colliding patterns, not the 15
the ticket records for `main`: `205fdd36f` (bl1267/bl1220/bl603, 5 patterns) is
already an ancestor of this branch. 15 − 5 = 10, so the two counts agree.

Which side was scoped is not arbitrary. `steps/index.js` fixes load order, so
`files[0]` is the file that answers that text today; scoping the LOSERS and
leaving the winner unscoped fixes each losing feature while leaving every
third feature that relies on the unscoped fallback resolving exactly as
before. Scoping both sides would have stranded those third features with no
handler at all — the ticket's third constraint. Third-party users were
enumerated from the feature files before each edit (BL-721, BL-679, BL-910,
BL-622, BL-490 and others), and every one of them was run afterwards.

| pattern | scoped (loser) | left unscoped (winner) |
|---|---|---|
| `a swarm running headless, with no editor attached` | retireLegacyTelegramNarrator, headlessResourceSampling | stuckEscalationEmail |
| `an approval ask was posted in a ticket's Telegram topic` | bl589ApprovalAskCarriesRulingOptions | bl490ExpediteApprovalButton |
| `no board message has been posted yet` | bl468PipelineBoardPostBeforeDelete | bl462PipelineBoardRefinements |
| `the ambulance is released` | bl852ChaseSweepRespectsAmbulanceHold | bl655AmbulanceModeHold |
| `the burndown is rendered` | burndownEta | pwaLabelCatalog |
| `the shipped repository documentation` | bl617NightlyCooldownWindow | bl623RoutingSkipTrail |
| `the supervisor checks whether it may spawn the replacement` | bl411NegotiationRelayKillsSupersededChild | bl403SupervisorKillsSupersededChild |
| `the swarm is running` | alwaysOnOperatorPresence | swarmSocketNotInTmp |
| `the swarm's health is reported` | restrictedFrontDeskOperator | mergedCodeReachesDaemons |
| `the ticket is still pending review` | bl589ApprovalAskCarriesRulingOptions | bl484DecidedAskClosesItself |

## A second collision class the invariant names and the ticket's prose does not

Invariant 1 says "never to another file's unscoped registration — **whatever
order the step files load in**". Identical patterns are not the only way to
breach that: a step text can be matched by a DIFFERENT, broader pattern in
another file. With the 10 above fixed, six real feature step texts were still
resolved by load order:

| step text | owning file | broader pattern elsewhere |
|---|---|---|
| `an agent blocked on a captured to-human gate in the message store` | gateAnswer | bl643 `^(an agent .+)$` |
| `the architect bounces the parcel to the coder naming the offending edge and the rule it breaks` | dependencyGate | bl606 `^(.+) bounces the parcel to (.+)$` |
| `the human negotiates the verbosity to concise` | theFrontDeskAnswersAtTheAgreedVerbosity | verbosityIsNegotiated `to (concise\|normal\|detailed)` |
| `the fleet console renders swarm "fes"` | bl437FleetStatusPublish | bl438 `"([^"]+)"` |
| `an agent can file a question through the ask protocol` | bl483MultiOptionAskButtons | bl643 `^(an agent .+)$` |
| `an agent enqueues a git_handoff parcel at "22:00" local` | bl617NightlyCooldownWindow | bl643 `^(an agent .+)$` |

Here the SPECIFIC side is scoped, never the broad one: pinning the literal to
its owning feature makes that feature's resolution deterministic while leaving
the catch-all available to everything else that depends on it. Scoping
`^(an agent .+)$` instead would have stranded every other feature whose "an
agent …" text only that catch-all matches.

After both halves: **0 colliding patterns, 0 order-dependent resolutions**
across all 14 503 shipped feature step texts.

Five of the six were already resolving to their own file (it loads first), so
only `bl437FleetStatusPublish` changed behaviour there — BL-437 and BL-438 are
both 4/4 after.

## The two declared invariants (BL-654)

`extension/test/bl1277StepCollisionInvariants.property.test.js`, property lane
only (`npm run test:properties`).

**Invariant 1** is encoded as order-independence over the real registry: real
`createStepRegistry()`, real `resolve()`, shipped registrations replayed in
permuted file order. Only the files that MATCH the drawn text are replayed —
`resolve()` returns the first match, so a non-matching file cannot change the
answer from any position, and dropping them is what makes the check affordable.

It is **exhaustive** over the ambiguous corpus (the 1 270 (feature, text) pairs
more than one step file matches), not sampled — and that is a finding, not a
preference. The sampled version was written first and was worthless: with a
real collision put back (`burndownEtaSteps` un-scoped again), 60 draws over
1 270 entries stayed GREEN, because only ~3 entries are affected. Exhaustive
over a finite enumerable domain is strictly stronger than drawing from it.

Because the sweep leaves nothing order-flippable behind, the corpus check alone
would be green and say nothing. So the second property is a generative
sensitivity draw: it DERIVES the offender from the drawn text (never an
independently drawn pair) by planting a second file registering that same text
unscoped, and asserts the check then reports a flip. Its corpus is narrowed to
entries where a flip is guaranteed by construction — entries whose own feature
scopes a matching handler, and entries where every other match is scoped
elsewhere, are immune by design, and drawing them made the reach floor a
lottery (measured: 9 flips in 100 draws, i.e. a floor that fails at random).

**Invariant 2** is encoded adversarially against the re-implementation it
forbids: four shapes that register a colliding pattern with the literal
`registry.define(` nowhere in the source (alias, loop, helper, computed
RegExp), and two that carry the literal while registering nothing (comment,
string). Each shape is drawn from its own `fc.assert` run, so the reach floor
is met by construction rather than by hoping a uniform `constantFrom` covered
every constant.

**Non-vacuity, both shown by running:**
- invariant 1: un-scoped `burndownEtaSteps`' `the burndown is rendered` again →
  the exhaustive check FAILS naming that resolution. Restored, green.
- invariant 2: made `registrationsByFile` skip files whose source lacks
  `registry.define(` — i.e. exactly the source scan the invariant forbids →
  the "without the literal" property FAILS on the `alias` shape. Restored,
  green.

## Runs

- **BL-1277 acceptance**: 5/5, from a committed tree.
- **Unit lane**: `test/bl1277UnscopedStepCollisionGuard.test.js` 6/6, and it
  appears in the `npm test` file list — the ticket's step 6, wired by vitest's
  glob with no call site.
- **Property lane**: 5/5 for the new file (the shipped-registry load makes
  collection ~40s; the assertions themselves are ~45ms).
- **Every at-risk feature ran.** The at-risk set was computed, not guessed:
  the 16 swept patterns matched against every step line of every `.feature`
  file gives 30 features, and all 30 were run (26 in the first sweep, 4 more
  in the second, `BL-484` last).

**Reds, every one of them baselined against this branch's HEAD rather than
assumed pre-existing:**

| feature | before | after | reading |
|---|---|---|---|
| BL-353-retire-legacy-telegram-narrator | 1/4 | 1/4 | unchanged, pre-existing |
| BL-240-remote-gate-answer-write-path | 0/4 | 0/4 | unchanged; fails on a missing `CURSOR_API_KEY`, environmental |
| BL-359-always-on-operator-presence | 5 pass / 2 fail | 5 pass / 2 fail | unchanged, pre-existing |
| BL-328-merged-code-reaches-running-daemons | 4 pass / 5 fail | 5 pass / 4 fail | one scenario RECOVERED by the sweep |

Two more, neither caused here:
- **BL-617-nightly-cooldown-window** did not finish inside 900s, twice. Not
  this parcel: `bl617` loads at index line 364 and `bl643` at 502, so bl617's
  own handler already answered that text before the change; the handler body
  is byte-identical to HEAD's, and the resolution was re-checked
  programmatically and is the same handler. The slow run predates this work.
- **BL-866-companion-manifest-package-catalog** 0/10. Not at risk: no pattern
  in any of the 16 edited files matches any of its step texts (checked, not
  assumed).

**Standing unit-lane red, recorded rather than hidden:** `npm test` is
27 files / 219 tests red on this branch, before and after, with the build
compiled. None of the failing files touch the step registry, and no failure
names any file this parcel adds or edits; the one spot-checked
(`unreachableStepHandlerCheck`) fails on `deps.checkOrphanedAuthoredDocs is not
a function`, an unrelated stub gap. This parcel neither caused nor fixes it.

## Surfaced, not swept

`swarmforge/scripts/wait_pipeline_drain.sh` is untracked in this worktree and
is not mine; nothing in the tree references it. Left exactly as found.
