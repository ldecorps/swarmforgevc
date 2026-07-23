# BL-606 — architect SEND BACK #3

**Parcel reviewed:** `d445f2eb75` (cleaner) — carries `20973ca69` (coder's fix
for architect bounce #2) on top of `1b06dd655`.
**Verdict:** SEND BACK to coder. One blocking defect (guardrail #4, and a
recurrence of bounce #1 defect 2 on the path that actually matters).
**Bounce #2 (`d3dcc83e0` / `BL-606-architect-bounce-2.md`): CONFIRMED FIXED.**

---

## Bounce #2 re-verification — fixed, correctly, and the test is now load-bearing

The call site now conses `literal-to` onto `hop-skipped-stages`' result
(`swarm_handoff.bb:444-445`), taking the inclusive-from-`literal-to` shape the
bounce note recommended as the safer of the two options.
`hop-skipped-stages` keeps its strictly-between docstring and its five unit
assertions unchanged. All three repros re-run against the **real**
`swarm_handoff.bb` send path (fresh sandbox, not the parcel's own fixtures):

| repro | required_stages | recorded `skipped=` | verdict |
|---|---|---|---|
| A | `[coder, qa]` | `cleaner,architect,hardender,documenter` | matches the ticket's QA procedure step 2 **verbatim** |
| B | one stage skipped | `cleaner` | was `[]` — now names the stage |
| C hop 1 | `[coder, architect, qa]` | `cleaner` | was `[]` |
| C hop 2 | same | `hardender,documenter` | was `documenter` |

Repro C's union is now `{cleaner, hardender, documenter}` — exactly the
complement of the effective set, so guardrail #6 is answerable from the runtime
trail alone. **Fixed.**

The strengthened scenario 03 assertion is **genuinely load-bearing**: reverting
only the call-site cons and re-running the feature fails test 5 (*"each skipped
stage leaves a greppable record naming the stage and the reason"*), 15 pass / 1
fail. Restored clean afterwards.

---

## BLOCKING defect — a reviewer's bounce is rewritten forward, onto the bouncer

Guardrail #4: *"NO OUT-OF-BAND STAGE INJECTION. required_stages constrains DOWN
from the full chain only. It cannot add stages, reorder them, or **run a stage
twice**."*

Bounce #1 defect 2 established that routing must never touch a backward
destination. The fix guards on `rejection_reason` / `reroute_reason`
(`swarm_handoff.bb:413-414`). Those two headers are stamped by the **operator
salvage tooling only** — `reroute.bb`, `reroute_resume.bb`, `redo_from.bb`.

**No reviewer bounce carries either header.** `rejection_reason` appears
nowhere an agent could learn it:

```
$ grep -rn "rejection_reason" swarmforge/handoff-protocol.md \
      swarmforge/roles/ swarmforge/constitution/
(no matches)
```

Every review role bounces by hand-writing a draft and running
`swarm_handoff.sh` — `architect.prompt` ("Send `git_handoff` to `coder` with
priority `00`"), `QA.prompt:184` (BL-425/BL-576: "Send `git_handoff` with
priority `00` to the EARLIEST pipeline role whose own domain contains any part
of the defect"). Neither prompt mentions `rejection_reason`, so the guard is
inert on exactly the path it was added to protect.

### Repro D — QA's doc-defect bounce lands back on QA

The sharpest case, because **the stage most likely to be a bounce target is the
stage that was skipped** — skipping it is what let the defect through.
`documenter` is droppable at the specifier's discretion per the ticket's own
QA/DOCUMENTER DROP RULE:

```
ticket:  required_stages: [coder, cleaner, architect, hardender, QA]
         stage_skip_reasons:
           documenter: no doc change

QA finds a docs defect and bounces to documenter (QA.prompt's own rule):

  drafted    to: documenter
  delivered  to: QA          <-- rewritten onto the sender
```

QA re-receives its own bounce. The parcel can never reach the role that owns
the fix, and QA has no way to redirect it — re-bouncing reproduces the rewrite
identically. This is a live self-bounce loop.

It is also the **"shipped without a documenter pass" burn recurring in a new
form**. The ticket names that incident as the reason guardrails #2/#3 exist;
here the routing defeats the *recovery* path from a documenter skip.

### Repro E — the architect's own send-back is rewritten onto the architect

```
ticket:  required_stages: [architect, documenter, QA]   (non-code; coder omitted, valid)

architect finds a violation and bounces to coder, per architect.prompt:

  drafted    to: coder
  delivered  to: architect
  routing_skipped: BL-910 coder->architect skipped=coder,cleaner
```

Same shape. Note the `routing_skipped` header records the rewrite as an
ordinary forward skip — the trail actively misreports a defeated bounce as a
successful optimization.

Control, same ticket, same send, `rejection_reason:` added by hand → delivered
`to: coder`. That isolates the cause to the missing header, not to anything
else in the draft.

### Why the existing tests all pass

`test_reroute.sh` case 06 and `test_redo_from.sh` case 06 both cover the guard
— but they drive `reroute.bb` / `redo_from.bb`, which **do** stamp the header.
No test drives a plain hand-written reviewer bounce, and the feature file has
no bounce/backward scenario at all (8 scenarios, 16 tests, none mention a
bounce). The uncovered path is the common one.

### Remediation

Do not key the guard on an optional header that no role writes. Derive
direction from the **sender**, which `-main` already has in scope at the call
site (`swarm_handoff.bb:562`, computed before `route-required-stages` at 571):
route only when `literal-to` is **strictly after the sender** in
`canonical-order`; otherwise return identity recipients. A bounce always
targets an earlier stage, so it falls through untouched without depending on
anything the sender remembered to write.

Two cases to handle explicitly:
- `specifier` is not in `canonical-order` — treat it as position −1 (before
  `coder`) so the ordinary `specifier -> coder` entry send still routes.
- Any other non-canonical sender (`coordinator`, unknown) → identity, the
  conservative default.

Keep the `rejection_reason` / `reroute_reason` guard as well — it is correct
for the operator salvage paths and cheap to retain.

Please add acceptance coverage for a backward bounce with the flag ON
(both repros D and E are one scenario each against the real send path), since
nothing currently exercises it.

---

## Architecture — clean, unchanged from bounce #2

- **Dependency gate (required hard gate):** PASSED per-parcel and full-repo, no
  forbidden edges.
- **Purity boundary holds.** `required_stages_lib.bb` is pure decision logic —
  no `slurp`/`spit`/`fs`; every read (conf, ticket yaml) and every write
  (envelope header, `routing-skips.jsonl`) lives in `swarm_handoff.bb`.
- **Kill-switch default OFF** (`config required_stages_routing_enabled false`),
  verified inert at the send path by scenario 15. The parcel therefore ships
  dormant — but the operator's standing intent is to flip it true on landing,
  so this defect is pre-live, not theoretical.
- **`routing_skipped` is in `reserved-fields`** (line 41), so an agent cannot
  forge one.
- **Ticket lookup is an exact `id:` match**, not a filename glob (BL-9005 vs
  BL-900 false collision guarded).
- **No out-of-band injection in the forward direction:** `next-required-stage`
  only selects from `canonical-order` strictly after the current index, so the
  set can only ever be constrained down. The defect above is the one direction
  where this does not hold.
- **Co-change (informational, never auto-bounce):** flags the BL-606 cluster
  itself plus `handoffd.bb` (6), `handoff_lib.bb` (3), `ready_for_next*.bb` (3).
  Routing resolves entirely at send time and the delivery side is untouched, so
  no coupling action is warranted.
- **Build green:** `npm install && npm run compile` clean; `.bb` unit suite
  `ALL PASS: required_stages_lib.bb`; `test_reroute.sh` / `test_redo_from.sh`
  ALL PASS; feature 16/16.
- **Property testing:** no property test warranted — the one property-shaped
  module in this parcel is babashka, and the pinned fast-check harness cannot
  reach `.bb`. Stated rather than manufactured vacuously, per the role's
  property-testing rule.

Per BL-490/BL-495 the bounced content is reverted out of this branch in the
same step as the send-back.
