# BL-1006 — declared invariants: stated reasons, not property tests (BL-654)

BL-654 requires that each declared invariant leave this parcel either as a
coder-authored executable property test or as a **stated reason** why it admits
no executable encoding — never silently unencoded. Both of BL-1006's invariants
take the stated-reason path. The reasons and the verification behind each are
below, so the architect can check the claim rather than take it.

- **Author**: coder, 2026-08-21.

## Invariant 1 — "the retirement deletes an obsolete claim, never a live check"

> every behaviour scenario 06 asserted is still asserted by a scenario that
> passes. Verified against BL-983's feature file, not asserted.

**Stated reason: it quantifies over a one-time act, and its own wording says
so.** The invariant ends "Verified against BL-983's feature file, not asserted"
— the specifier is explicitly asking for a verification, not an assertion. There
is no pure, testable module to quantify over: the subject is scenario 06, which
this parcel deletes. A property test written after the deletion could only
re-assert BL-983's contract, which is precisely the duplication the ticket's
"retire, never reword" instruction forbids.

**The verification it asks for, performed:**

| scenario 06 asserted | successor | result |
|---|---|---|
| the parcel reaches the bare seat, not the second | BL-983 sc01 "a parcel addressed to a stage reaches exactly one of its seats" | pass |
| the second seat does not take a parcel that is another's | BL-983 sc05 "a parcel already claimed by one seat is never handed to another" | pass |

`node specs/pipeline/cli.js specs/features/BL-983-stage-mailbox-delivers-to-one-idle-seat.feature`
→ **5 passed / 0 failed**, all five named scenarios green.

## Invariant 2 — "a step handler is deleted only when no scenario still reaches it"

> and handler scoping is read from the registration call rather than inferred
> from the pattern text.

**Stated reason: it quantifies over the deletion decision — a process act — not
over a module.** "A handler is deleted only when…" constrains how the
implementer chooses, and "scoping is read from the registration call" is an
instruction about how to read source. Neither has a runtime subject.

**Why not encode it as a repo-wide reachability property instead.** That
generalisation — *no scoped registration is unreachable from its own feature* —
is a real and durable property, and it was attempted here before being
abandoned deliberately, for two reasons worth recording:

1. **It is a different, larger slice.** The ticket already refuses the adjacent
   generalisation by name ("Do not widen scope to a linter… If it is worth
   building, it is worth its own ticket"). A registry-wide gate is that same
   move at the same altitude.
2. **Its arrival colour is unknown.** The registry exposes no enumeration API,
   so measuring today's unreachable-handler count needs an instrumented
   recording double walked across every feature file. That probe did not
   complete inside two minutes on this host. Landing a gate whose green/red
   state on `main` has never been observed is the BL-997 trap — a correct gate,
   red on arrival, inside a parcel scoped as a deletion.

Both stage_skip_reasons the coordinator relied on ("no code is added, so there
is nothing to DRY"; "a deletion adds no code to mutate") would also have been
falsified by adding a property test here.

**The verification it asks for, performed** — read from the registration call,
not the pattern text, exactly as the invariant directs:

- `bl982SecondSeatSteps.js` registered all three deleted handlers via
  `scoped(re, fn)`, a local wrapper over `registry.defineScoped(re, fn, FEATURE)`
  with `FEATURE = 'BL-982 …'`.
- `bl983StageQueueSteps.js:116` registers the identically-worded
  `/^a parcel addressed to that stage is delivered$/` under its OWN
  `defineScoped(…, FEATURE)`. Confirmed untouched: `git diff` against that file
  is empty.
- BL-982's own feature file is the only one containing the retired scenario's
  step text; after the deletion `node specs/pipeline/cli.js` on it is **6/6 with
  scenario 06 absent from the output**, not passing — the shape the ticket's
  `qa_e2e_procedure` step 2 demands.

## Full verification for this parcel

| check | result |
|---|---|
| BL-982 acceptance at parent commit (reproduce) | 6 pass / 1 fail at "And the second seat claims nothing", parcel claimed by seat `coder-fable` — matches the ticket exactly |
| BL-982 acceptance at this parcel | **6/6**, scenario 06 absent |
| BL-983 acceptance (successor coverage) | **5/5** |
| BL-983 step file | untouched, empty diff |
| `docs/reference/Specification.MD` | not edited — out of scope per the documenter skip reason |
| `os.tmpdir()` re-introduced into `bl982SecondSeatSteps.js`? | no — only BL-1002's explanatory comment names it |
| `socketFixtureShortRootGuard.test.js` (BL-948 standing guard) | **16/16** |
