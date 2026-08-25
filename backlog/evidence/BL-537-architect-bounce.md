# BL-537 — architect review: SEND BACK to coder (round 1)

- Ticket: BL-537 "Mono-router: missing rotate-target session must heal, not report healthy-dormant"
- Reviewed commit: `06f4acae41` (from cleaner)
- Reviewed at: 2026-07-23
- Prior bounce history on `main` for BL-537: none (`git log main -- 'backlog/evidence/BL-537*'` empty) — this is round 1.

## Verdict

**SEND BACK.** The behavior is right and the tests are real; two architectural
boundary defects must be fixed before this lands. Both are introduced by this
parcel, both are cheap, and both make the just-filed **BL-571**
(`depends_on: [BL-537]`, which rewrites this same decision) strictly harder if
they ship.

This is **not** a correctness bounce. I found no defect in what the code does —
see "What I verified and what passes" below. Do not re-litigate the behavior.

## What I verified and what passes (do NOT redo this)

- `bash swarmforge/scripts/test/test_swarm_ensure.sh` → **ALL PASS**, 27 cases,
  including the two new BL-537 cases and the BL-530 round-3 classic-pack
  regression guard ("classic pack with one half-launched session is not treated
  as mono-router").
- Dependency-rule gate (**required hard gate**): full-repo scan
  `node extension/out/tools/dependency-gate.js` → **PASSED: no forbidden edges.**
  (Per-file invocation is not applicable: no parcel file is extension TS/JS, and
  the gate resolves paths relative to `extension/`.)
- Co-change report on `swarm_ensure.bb` — see "Co-change evidence" below.
- **Failure-mode parity is correct.** `dormant-rotate-viable?` genuinely mirrors
  `handoff_lib.bb/rotate-resident-to!`:
  - launch script path matches — ensure's `state-dir/launch/<role>.sh`
    == handoff_lib's `(target-root)/.swarmforge/launch/<role>.sh`.
  - resident identity matches — handoff_lib's `mono-router-resident-session` is
    documented as "first non-coordinator roles.tsv session", the same rule.
  - Checking `pane-alive?` where `rotate-resident-to!` only checks
    `(str/blank? session)` is **stricter, and correctly so**: a named-but-dead
    session reaches `tmux respawn-pane -k` and returns `tmux-exit-N`, so rotate
    really would fail. Good call.
- **Resident-before-dormant ordering is structurally guaranteed**, not just
  conventional: resident is by definition the first non-coordinator entry in
  `ordered`, and `ordered` is `(mapv :role rows)`, so every dormant role is
  processed strictly after any resident repair. The comment at
  `swarm_ensure.bb:551-554` is accurate.

## Finding 1 — resident-identity rule duplicated at the IO edge (encapsulation)

`swarmforge/scripts/swarm_ensure.bb:555`

```clojure
resident-role-name (first (remove #(= "coordinator" %) ordered))
resident-session   (some #(when (= (:role %) resident-role-name) (:session %)) rows)
```

This re-implements, inline at the IO edge, a topology rule the pure module
already owns and **already exports**:

- `mono_router_lib.bb:37 classify-role` — *"Resident = first role that is not
  coordinator"*, identical expression.
- `handoff_lib.bb:436 mono-router-resident-session` — same rule again.

`swarm_ensure.bb` delegates every *other* topology decision in this very
function to the lib — `topology-action` (line 461) and `classify-role`
(line 462). Line 555 is the one that does not. That is an information-hiding
break: ensure now hard-codes *how* the lib picks a resident, so if the lib ever
moves to the declared `config rotation_home` signal (`parse-rotation-home`
already exists at `mono_router_lib.bb:199` and is already used by
`ready_for_next_task.bb` / `ready_for_next_batch.bb`), this copy silently
diverges — and diverges into checking the *wrong* resident.

### Remediation (no new API needed — `classify-role` is already imported)

```clojure
resident-session (some #(when (= :resident (mono-router-lib/classify-role ordered (:role %)))
                          (:session %))
                       rows)
```

Delete `resident-role-name` entirely.

## Finding 2 — new policy decision placed at the IO edge, not in the pure module

`swarmforge/scripts/swarm_ensure.bb:434-450` — `dormant-rotate-viable?` is a
*decision* (a two-condition conjunction plus its reason precedence), but it is
written at the edge and reaches straight into IO: `pane-alive?` (tmux) and
`fs/exists?` (filesystem).

engineering.prompt: *"Verify high-level policy stays independent of IO/UI/
framework/filesystem details, and low-level adapters depend inward."*
`mono_router_lib.bb` is this area's pure decision module and already hosts every
sibling decision. Consequence today: this decision cannot be exercised without a
fake `tmux` binary and a fixture filesystem — which is why each new case costs
~40 lines of shell. In the pure module it is a three-line assertion in
`swarmforge/scripts/test/mono_router_lib_test_runner.bb`, which already exists.

This is the same position I recorded on the sibling ticket, and the specifier
has already written it into **BL-571**: *"Add the new predicate to the pure
module. `mono_router_lib.bb` is pure (text/data in, decisions out) ... all
tmux/conf IO stays at the edge in `swarm_ensure.bb`."* BL-537 must not land the
opposite shape one ticket ahead of it.

### Remediation

In `mono_router_lib.bb`:

```clojure
(defn rotate-viable?
  "Pure: could rotate_to_role place work on this dormant target right now?
   Mirrors rotate-resident-to!'s two failure modes, in its precedence order."
  [{:keys [resident-alive? launch-script-present?]}]
  (cond
    (not resident-alive?)        {:viable? false :reason "no live resident session to rotate from"}
    (not launch-script-present?) {:viable? false :reason "missing launch script for role"}
    :else                        {:viable? true}))
```

In `swarm_ensure.bb`, keep only the probes:

```clojure
:dormant-ok
(let [{:keys [viable? reason]}
      (mono-router-lib/rotate-viable?
        {:resident-alive? (boolean (and resident-session (pane-alive? socket resident-session)))
         :launch-script-present? (fs/exists? (rotate-target-launch-script role))})]
  ...)
```

Keep `rotate-target-launch-script` at the edge — it is path IO and belongs there.

**Two things to preserve:**
1. **Reason precedence must stay resident-first.** Both existing tests assert the
   exact reason string; a swapped `cond` order silently changes which reason a
   doubly-broken swarm reports.
2. Eager evaluation now performs `fs/exists?` even when the resident is dead
   (the current `cond` short-circuits). That is an intended, harmless cost — do
   not reintroduce laziness by pushing the probes back inside the decision.

Add a unit test to `mono_router_lib_test_runner.bb` covering all three outcomes.
The two shell cases in `test_swarm_ensure.sh` stay as the wiring proof and must
remain green.

## Co-change evidence (informational, per BL-255 — did not drive this bounce)

`node extension/out/tools/co-change-report.js swarmforge/scripts/swarm_ensure.bb`

```
swarmforge/scripts/swarmforge.sh:            13 co-change(s) (SUSPECTED COUPLING)
swarmforge/scripts/test/test_swarm_ensure.sh: 9 co-change(s) (SUSPECTED COUPLING)
start-swarm.sh:                               6 co-change(s) (SUSPECTED COUPLING)
swarmforge/scripts/handoff_lib.bb:            5 co-change(s) (SUSPECTED COUPLING)
```

`handoff_lib.bb` at 5 is the one worth naming: this parcel deliberately mirrors
`handoff_lib.bb/rotate-resident-to!`'s failure modes, but nothing in code links
the two — the mirroring lives only in a docstring. The history says these files
already drift together. Routing the decision through `mono_router_lib.bb`
(Finding 2) gives the two edges one shared, testable definition to agree on
instead of a prose promise.

## Scope check (BL-506)

Parcel diff vs `main` is three files — `swarmforge/scripts/swarm_ensure.bb`,
`swarmforge/scripts/test/test_swarm_ensure.sh`, and `specs/pipeline/steps/index.js`.
The `index.js` hunk is a pure re-ordering of two adjacent `require`s
(`bl560`/`bl566`) with no functional effect: both step files register only
fully-anchored `^...$` patterns that cannot shadow one another. No ticket-less
functional files. **Scope is clean.**

## Branch hygiene (BL-490/BL-495)

My review merge of `06f4acae41` is reverted out of `swarmforge-architect` in the
same step as this bounce, so un-approved content is not an ancestor of my next
review. **On rework, the revert must be reverted first** (`git revert` of the
revert commit) before merging the coder's new tip — otherwise git treats the
original hunks as already-handled and silently drops them.
