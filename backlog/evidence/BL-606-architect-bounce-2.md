# BL-606 — architect SEND BACK #2

**Parcel reviewed:** `d29acb3d6e` (cleaner) — carries `f8daeeca4a` (coder's fix
for architect bounce #1) on top of `3dcdf26b49`.
**Verdict:** SEND BACK to coder. One blocking defect (guardrail #2/#6).
**Bounce #1 (971bac9f5 / `BL-606-architect-bounce.md`): both defects CONFIRMED FIXED.**

---

## Bounce #1 re-verification — both fixed, correctly

**Defect 1 (prose-read declaration, guardrail #1).** `read-required-stages` now
anchors the `required_stages: ` prefix at column 0 instead of trimming first
(`required_stages_lib.bb:52`), matching `chase_sweep_lib/read-yaml-field` and
the sibling `read-stage-skip-reasons`. BL-606's own active ticket — four
indented prose mentions, no real declaration — now resolves `:default-full`.
Unit fixtures for the indented case added. **Fixed.**

**Defect 2 (bounces/reroutes silently rerouted, guardrail #4).**
`route-required-stages` now takes the draft `headers` and returns identity
recipients when `rejection_reason` or `reroute_reason` is present
(`swarm_handoff.bb:412-416`). I checked every `salvage_lib/queue-handoff!`
caller: `reroute.bb:108` (`reroute_reason`), `reroute_resume.bb:41`
(`reroute_reason`), and `redo_from.bb:52` — which previously carried NO
distinguishing header at all and now stamps `rejection_reason`. All three
out-of-order producers are covered, with send-path coverage in
`test_reroute.sh` / `test_redo_from.sh`. **Fixed.**

---

## BLOCKING defect — every hop's routing record drops its first skipped stage

Guardrail #2: *"When a stage is skipped, the handoff/commit lineage must carry
an explicit, greppable record — **which stage**, and the specifier's stated
reason."* Guardrail #6: ran-vs-skipped must be answerable from that trail.

`hop-skipped-stages` (added by `f8daeeca4a` as non-blocking defect 3) is
**correct per its own docstring and unit tests** — it returns canonical stages
*strictly between* `current` and `next`, and its five unit assertions all pass
`coder` (the **sender's** stage) as `current`:

```clojure
;; required_stages_test_runner.bb:173
(assert= "hop-skipped-stages-02: a multi-stage jump skips every stage strictly between"
         ["cleaner" "architect" "hardender" "documenter"]
         (required-stages-lib/hop-skipped-stages "coder" "QA"))
```

But the **call site passes the wrong `current`** — `literal-to`, which is the
first *skipped* stage, not the sender's stage:

```clojure
;; swarm_handoff.bb:435-438
:routing-skipped {:ticket-id ticket-id
                  :from literal-to
                  :to next-stage
                  :skipped (required-stages-lib/hop-skipped-stages literal-to next-stage)
```

The rewrite branch is only reached when `(not (contains? effective literal-to))`
— so `literal-to` is **by construction always a skipped stage**, and excluding
it is a systematic off-by-one on *every* hop, not an edge case.

### Repro A — the ticket's own QA end-to-end procedure, step 2

The ticket pins the expected content verbatim: *"a `routing_skipped:` header
naming **cleaner**/architect/hardender/documenter is present"*.

```
ticket:  required_stages: [coder, qa]
send:    coder -> cleaner   (real swarm_handoff.bb, SWARMFORGE_REQUIRED_STAGES_ROUTING=1)

delivered:
  to: QA
  routing_skipped: BL-901 cleaner->QA skipped=architect,hardender,documenter reasons=...
  .swarmforge/routing-skips.jsonl:
  {"ticket-id":"BL-901","from":"cleaner","to":"QA",
   "skipped":["architect","hardender","documenter"], ...}
```

`cleaner` is **absent from `skipped=`**. It appears on the line only as the
`from` token and inside the `reasons=` string — which is exactly why the
acceptance assertion misses it (see below).

### Repro B — a single-stage skip records NO stage at all

The conservative, most likely first real use of this feature (skip one stage):

```
ticket:  required_stages: [coder, architect, hardender, documenter, qa]
         stage_skip_reasons:
           cleaner: no cleanup needed
send:    coder -> cleaner

delivered:
  to: architect
  routing_skipped: BL-900 cleaner->architect skipped= reasons=cleaner:no cleanup needed
  .swarmforge/routing-skips.jsonl:
  {"ticket-id":"BL-900","from":"cleaner","to":"architect","skipped":[], ...}
```

**`skipped=` is empty and `"skipped":[]`.** A routing rewrite happened, the
parcel jumped a stage, and the runtime record names no skipped stage
whatsoever. That is guardrail #2's stated failure mode — "a silent gap in the
trail" — reached on the single most conservative configuration of the feature.

### Repro C — multi-hop under-reporting breaks guardrail #6

```
required_stages: [coder, architect, qa]

hop to=cleaner    -> rewritten=architect   recorded=[]              should-be=[cleaner]
hop to=hardender  -> rewritten=QA          recorded=[documenter]    should-be=[hardender documenter]
```

Union of runtime records = `{documenter}`; stages actually skipped =
`{cleaner, hardender, documenter}`. Two of three skips are invisible in the
runtime trail. The committed layer (`ran-and-skipped` off the ticket yaml) is
still correct — but that layer records *intent*; the runtime trail is the layer
that proves what actually happened, and it under-reports on every hop.

### Remediation

The hop's skips are the canonical stages from `literal-to` **inclusive** to
`next-stage` exclusive — all of which are non-members of `effective` by
construction. Either add an inclusive-of-`current` variant for the call site,
or pass the sender's stage as `current` (note: the sender is not always a
canonical stage — a `specifier -> coder` send would normalize to `nil` and
degrade to `[]`, so the inclusive-from-`literal-to` form is the safer shape).
Exact shape is the coder's call; keep `hop-skipped-stages`' current
strictly-between semantics or rename it if you change them, since its docstring
and five unit assertions encode the existing contract.

---

## Secondary — the acceptance assertion cannot catch this (please fix with it)

All 16 scenarios pass (`node specs/pipeline/cli.js
specs/features/BL-606-...feature` → `# pass 16 # fail 0`), including scenario 03
*"the routing record names each skipped stage and its stated reason"*. It passes
**vacuously**:

```js
// bl606RequiredStagesRoutingSteps.js:263-267
for (const stage of ['cleaner', 'architect', 'hardender', 'documenter']) {
  if (!line.includes(stage)) { throw ... }        // substring over the WHOLE line
}
```

`line.includes('cleaner')` is satisfied by the `from` token (`cleaner->QA`) and
by `reasons=cleaner:r1` — it never inspects the `skipped=` field. The handler
then parses the jsonl entry but asserts only `entry.reasons[stage]`;
`entry.skipped` is never asserted at all, though it is right there and is the
machine-readable form of the same claim. Assert against the parsed `skipped=`
list and `entry.skipped` so this cannot regress.

---

## What is clean (re-verified this pass)

- **Dependency-rule gate: PASSED**, per-parcel (`specs/pipeline/steps/index.js`,
  `bl606RequiredStagesRoutingSteps.js`) and full-repo — no forbidden edges.
- **Two-layer boundary intact.** `required_stages_lib.bb` is genuinely pure
  (no fs/env/IO); every read, conf lookup, env seam and jsonl append stays in
  `swarm_handoff.bb`. Nothing new touches the webview, browser storage, or
  spawns a process outside tmux.
- **Kill-switch correctly default-OFF** (`config required_stages_routing_enabled
  false`), env seam `SWARMFORGE_REQUIRED_STAGES_ROUTING` in the established
  `skip-daemon?` shape; verified inert end-to-end at the send path.
- **`routing_skipped:` is in `allowed-fields`** and stamped only by the tool, so
  it cannot trip BL-365 quarantine.
- **Ticket lookup is exact-`id:`-match**, not a filename glob — no BL-900/BL-9005
  false collision.
- **Co-change report**: `redo_from.bb ↔ swarm_handoff.bb` (3) and
  `redo_from.bb ↔ test_redo_from.sh` (3) flagged as suspected coupling. Both are
  the known salvage-path cluster and the parcel *did* change them together, which
  is the correct response to that coupling, not a violation. No action.
- **Unit suite green**: `bb required_stages_test_runner.bb` → `ALL PASS`.
- **Property testing**: no new property test warranted. The one property-shaped
  pure module here (`required_stages_lib.bb` — round-trip and subset invariants
  would fit well) is **babashka**, and this project's property harness is
  fast-check under `npm run test:properties` over `*.property.test.js`, which
  cannot reach `.bb`. Its `.bb` unit runner is the real gate per
  engineering.prompt's tool table. Stated rather than manufacturing a vacuous
  property test.

## Bounce hygiene

Per BL-490/BL-495 the bounced content is reverted out of `swarmforge-architect`
in the same step as this send-back: `git revert -m 1 cc2383668` (first parent =
this branch's prior tip). Verified the review-merge diff is purely BL-606 — no
already-landed `main` content is carried away by the revert — and that
`git merge-base --is-ancestor d29acb3d6e HEAD` is FALSE afterwards.
