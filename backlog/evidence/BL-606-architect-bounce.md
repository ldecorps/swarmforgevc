# BL-606 — architect SEND BACK

**Parcel reviewed:** `3dcdf26b49` (`BL-606: specifier-declared required_stages routing`, `By coder.`)
**Received from:** cleaner
**Verdict:** SEND BACK to coder. Two defects, each a direct violation of one of
the ticket's own non-negotiable guardrails. Both are proven below with a real
repro, not inferred.

Architecture itself is **clean** — see "What passed" at the bottom. This is not a
boundary bounce; it is the correctness-defect send-back the architect role owes a
parcel it can see a defect in (BL-333).

---

## Defect 1 (BLOCKING) — a ticket that merely *mentions* `required_stages` in prose gets a real declaration, and real stages get skipped

Violates guardrail **#1 DEFAULT-FULL**: *"Absent or unparseable `required_stages`
=> the ticket runs the FULL pipeline."*

`required_stages_lib.bb:52` trims each line **before** testing the field prefix:

```clojure
(some (fn [l] (let [t (str/trim l)] (when (str/starts-with? t prefix) t)))
      (str/split-lines (or content "")))
```

So any **indented** occurrence — inside a `description: |` block, inside
`acceptance:`, inside a quoted example — is read as the ticket's top-level
declaration.

### Repro A — BL-606's own active ticket

`backlog/active/BL-606-specifier-declared-required-stages-routing.yaml` has **no
top-level `required_stages:` field at all**. It has four prose mentions inside
`description:`/`acceptance:`. The reader picks the first one:

```
$ bb -e '(load-file "swarmforge/scripts/required_stages_lib.bb") ...'
read-required-stages => {:present? true, :raw "[architect, coder, qa, hardener, cleaner, documenter]"}
resolve-effective    => {:source :declared, ...}
```

`:source :declared` on a ticket that declared nothing. It is harmless *only* by
luck — that particular prose line happens to name all six stages.

### Repro B — the same bug with a partial prose example (the real hazard)

```yaml
id: BL-999
description: |
  We should consider whether a ticket like this one could declare
  required_stages: [coder, QA]
  but this is prose in a description block, NOT a declaration.
```

```
field    => {:present? true, :raw "[coder, QA]"}
decision => {:source :declared, :effective #{"QA" "coder"}}
skipped  => ["cleaner" "architect" "hardender" "documenter"]
cleaner -> next required => "QA"
```

Four stages — cleaner, architect, hardener, documenter — silently skipped on a
ticket whose specifier never opted in. With routing ON that parcel jumps
coder → QA. This is precisely the "shipped without a documenter pass" failure
class the ticket exists to make impossible.

### Why this is unambiguous, not a judgement call

- The ticket's own FIELD & FORMAT decision says to mirror
  `chase_sweep_lib/read-yaml-field` (~line 718). That reader does **not** trim —
  it anchors at column 0:
  ```clojure
  (some (fn [line] (when (str/starts-with? line prefix) ...)) (str/split-lines content))
  ```
- The **sibling function in the same new file**, `read-stage-skip-reasons`
  (`required_stages_lib.bb:87`), already anchors correctly:
  `(str/starts-with? l "stage_skip_reasons:")` on the untrimmed line. The
  inconsistency between the two readers is itself the evidence the trim is
  accidental.

### Remediation

1. Drop the `str/trim` from the prefix test in `read-required-stages` — match
   `read-yaml-field` / the sibling `read-stage-skip-reasons` exactly.
2. Add a unit-test fixture to `required_stages_test_runner.bb` with an
   **indented** `required_stages:` inside a `description: |` block asserting
   `{:present? false}`. Every existing fixture puts the field at column 0, which
   is why this shipped uncovered. Use BL-606's own ticket text as the fixture if
   convenient — it is a real-world instance.

---

## Defect 2 (BLOCKING) — bounces and operator reroutes get silently redirected forward

Violates guardrail **#4 NO OUT-OF-BAND STAGE INJECTION**: *"It cannot add stages,
**reorder them, or run a stage twice** — it is a subset selector over the
canonical order."*

`route-required-stages` (`swarm_handoff.bb:402`) rewrites `to:` for **every**
`type: git_handoff` with a single recipient. It has no access to — and does not
check — `rejection_reason` or `reroute_reason`. Both are valid on a
`git_handoff` (`swarm_handoff.bb:245-246`), and both mark a **deliberately
out-of-order, explicitly-chosen destination**:

| Sender | Header | Destination semantics |
|---|---|---|
| QA / any reviewer bounce | `rejection_reason` | **backward** — send it back to the role that must fix it |
| `redo_from.bb:43` | (rewind) | **backward** — operator names the stage: `redo_from.sh <item> <stage>` |
| `reroute.bb:108`, `reroute_resume.bb:41` | `reroute_reason` | **out-of-order detour** — that is the script's entire purpose |

All three go through `salvage_lib/queue-handoff!` → `swarm_handoff.sh`, so all
three hit the new rewrite.

### Failure scenario

Ticket declares `required_stages: [cleaner, documenter, QA]` (non-code, `coder`
omitted — legal). QA finds a defect needing code and bounces:

```
type: git_handoff
to: coder
rejection_reason: acceptance scenario 3 fails on empty input
```

`coder` ∉ effective ⇒ `next-required-stage(effective, "coder")` = `"cleaner"`.
The rejection is delivered to **cleaner** — a stage the parcel already passed.
Cleaner has no defect to fix, forwards on, the parcel walks back to QA unfixed.
A backward rejection has been converted into a forward advance, and an
already-run stage has been run twice. That is guardrail #4, twice over.

### The worse half: salvage state desynchronises from reality

- `reroute.bb` writes `{:pending_return from-stage}` and a livelock history keyed
  on `[from-stage to-stage]` — using the `to-stage` it *asked* for, not the one
  that was delivered. `reroute_resume.bb` then returns the parcel from a stage
  that never received it, and the livelock detector guards a transition that
  never happens.
- `redo_from.bb` tags `redo/<item>/<stage>/<ts>` and logs `from_stage: <stage>`
  for a stage that never got the parcel. It prints the queued filename; the
  rewritten `to:` inside it is invisible to the operator.

An operator typing `redo_from.sh BL-x coder` and silently getting `cleaner` is
the opposite of the ticket's stated goal ("dynamic WITHOUT making it opaque").

### Corroboration from the co-change tool (BL-255)

`node extension/out/tools/co-change-report.js swarmforge/scripts/swarm_handoff.bb`
flags exactly this family as logically coupled to the file this parcel changed:

```
swarmforge/scripts/handoffd.bb:            6 co-change(s) (SUSPECTED COUPLING)
swarmforge/scripts/handoff_inject_lib.bb:  4 co-change(s) (SUSPECTED COUPLING)
swarmforge/scripts/handoff_lib.bb:         3 co-change(s) (SUSPECTED COUPLING)
swarmforge/scripts/redo_from.bb:           2 co-change(s)
swarmforge/scripts/salvage_lib.bb:         2 co-change(s)
swarmforge/scripts/test/test_reroute.sh:   2 co-change(s)
swarmforge/scripts/test/test_redo_from.sh: 2 co-change(s)
```

None of them were touched, and neither `test_reroute.sh` nor `test_redo_from.sh`
was extended to prove they still route where they claim under routing-ON.

### Remediation

1. Thread the draft `headers` into `route-required-stages` and return the
   identity result when `rejection_reason` **or** `reroute_reason` is present. A
   deliberately-chosen destination is never rewritten — routing only ever
   short-circuits the *forward* chain.
2. Add coverage proving it, at the send path (not just the pure fn):
   - a routing-ON send with `rejection_reason` to a non-required stage delivers
     to that stage unchanged;
   - the same for `reroute_reason` (extend `test_reroute.sh` /
     `test_redo_from.sh`, which already assert the header survives).

---

## Defect 3 (fix while you are in there, not independently blocking) — `routing_skipped` over-reports

`route-required-stages` records `(skipped-stages effective)` — the **whole**
set-complement of the effective set — but the docstring says
*"whichever stage(s) got skipped **this hop**"*, and the envelope header reads
`skipped=...` as if it were this hop's skips.

With `required_stages: [coder, architect, QA]`, the coder→cleaner hop skips only
`cleaner`, yet the header claims
`skipped=cleaner,hardender,documenter`. `hardender`/`documenter` have not been
skipped yet — they are skipped two hops later, where the same full list is
emitted again. Every hop's `routing-skips.jsonl` line therefore carries the same
aggregate, so "what did *this* hop skip" is unanswerable from the trail.

Either compute this hop's actual skips (the canonical stages from `literal-to` up
to, but excluding, `next-stage`) or correct the docstring/field name to say it is
the ticket-level skip set. Given guardrail #6 asks for per-ticket ran-vs-skipped
visibility, the aggregate is defensible — the *docstring claiming otherwise* is
not.

---

## What passed (do not re-do this work)

- **Dependency-rule gate (BL-259, hard gate): PASSED**, both per-parcel
  (`../specs/pipeline/steps/bl606RequiredStagesRoutingSteps.js`,
  `../specs/pipeline/steps/index.js`) and full-repo scan. No forbidden edges.
- **Layering: clean.** `required_stages_lib.bb` is genuinely pure — every fn takes
  ticket *content* (a string), never a path; no `fs`, no `sh`, no config reads. All
  IO (conf slurp, backlog glob, jsonl append, envelope write) stays in
  `swarm_handoff.bb`. High-level policy independent of IO, adapters depending
  inward — exactly right.
- **Two-layer boundary: untouched.** No TypeScript, no webview, no browser
  storage, no process spawning from a view. Babashka + conf only.
- **Kill-switch design: correct and conservative.** Default OFF; env seam
  `SWARMFORGE_REQUIRED_STAGES_ROUTING` mirrors the existing `SWARMFORGE_SKIP_DAEMON`
  shape; a `--pack` conf without the line still reads OFF via
  `parse-config-value`'s default. The "one flag away from today" requirement holds.
- **Identity-degradation discipline: good.** Non-`git_handoff`, multi-recipient,
  no ticket id, unreadable yaml, `:default-full`, and `next-stage = nil` all
  return the untouched recipients. `to: coordinator` / `to: specifier` normalize
  to `nil` and fall through — verified.
- **Ticket lookup collision-safe.** `active-ticket-yaml-content` matches on the
  yaml's own `id:` field rather than a filename prefix — avoids the BL-900 /
  BL-9005 false match. Good call, and worth keeping.
- **New envelope header is delivery-safe.** `handoff_lib/parse-envelope` is
  permissive and `required-envelope-headers` is only `from/to/priority/type`, so
  `routing_skipped:` cannot trip BL-365 quarantine. Adding it to `reserved-fields`
  correctly blocks agents from forging it.
- **`bb swarmforge/scripts/test/required_stages_test_runner.bb` → `ALL PASS`.**
- **`npm install && npm run compile` → clean.**

## Carry-forward for the documenter (not a bounce reason)

`swarmforge/handoff-protocol.md` is the constitution's named exhaustive field
reference and "must not diverge from the tool's actual grammar". `routing_skipped`
is a new **reserved** envelope header and is not documented there. It co-changes
with `swarm_handoff.bb` (2 co-changes). Please pick this up at the documenter
stage.

## Note for whoever re-merges this parcel

Per BL-490/BL-495 the bounced content was reverted out of `swarmforge-architect`
in the same step as this send-back. The revert targets **only** commit
`3dcdf26b49` (BL-606's own six files) — deliberately *not* `git revert -m 1` of
the review merge, which would also have reverted the ~20 already-landed `main`
commits (BL-589..BL-605 specs) the coder's merge brought along.

Consequence: when the reworked BL-606 comes back, this branch must **revert the
revert** (or resolve the modify/delete conflicts by taking theirs) before merging
— otherwise files this parcel touched that the rework does *not* touch (e.g.
`swarmforge.conf`) would be silently dropped by the merge. Check the merged tree
contains all six BL-606 files before forwarding.

---

By architect.
