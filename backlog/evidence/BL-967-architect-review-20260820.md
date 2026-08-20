# BL-967 — architect review pass 1: BOUNCE to coder (complete inventory)

- **Ticket**: BL-967 handoffd cycle stall — bounded waits and sweep boundaries
- **Commit reviewed**: `ac342019ed` (cleaner) — parcel commits `95eebfcbf` (coder) + `ac342019e` (cleaner)
- **Reviewer**: architect, 2026-08-20
- **Verdict**: BOUNCE to **coder** (earliest blamed role). 4 defects: D1–D2 coder, D3–D4 readability.

This is one bounce for the whole review pass (Article 4.4). Every check I own was
run or is recorded BLOCKED; nothing was assumed clean.

---

## D1 — invariant 1 violated: two unbounded subprocess sites remain inside the poll cycle
**Class**: `behavior` · **Blamed**: coder

Declared invariant 1: *"No single subprocess or file-I/O wait inside the daemon's
poll cycle can silently exceed the freshness threshold: every such wait carries a
bound well under the threshold, and hitting the bound is logged and survived."*

I computed the **transitive `load-file` closure** from `handoffd.bb` (37 files) and
scanned it comment-stripped. Two call sites still spawn subprocesses on
`babashka.process/sh` rather than the new chokepoint:

### D1a — `swarmforge/scripts/agent_runtime_inject.bb:15`
```clojure
(defn tmux! [& args]
  (apply process/sh "tmux" args))      ; UNBOUNDED
```
This is a **second, identically-named `tmux!`** that the parcel did not convert
(only `handoffd.bb`'s own `tmux!` was). It backs `capture-pane-text`
(`agent_runtime_inject.bb:18`, called at `:93` and `:103`) and every `send-keys`
in `send-submit!`/`execute-step!` (`:40`, `:41`, `:48`, `:57`).

Reached from, at minimum:
- the **1 s delivery tick** — `poll-once!` (`handoffd.bb:610`) → `deliver!` →
  `notify!` (`:446`, `:600`) → `agent-runtime-inject/notify-agent!` (`:372`, `:382`)
- the **chase sweep** — `handoffd.bb:1684`
- both **context-clear sweeps** — `handoffd.bb:3022`, `:3077`, `:3082`

This is not a peripheral miss. The parcel bounded the busy-**gate** capture-pane
(`handoffd/recipient-pane-busy?` → `handoffd/capture-pane-text` → bounded `tmux!` ✓)
but left the wake-**delivery** capture-pane and send-keys that run immediately
after it unbounded. The ticket description names exactly these:
*"the chase path is dense with unbounded tmux!/process/sh calls (capture-pane on
every busy-gate, **send-keys wake delivery**, git rev-parse per worktree)"*, and
the stall signature is a burst of `chase-wake-skip-busy` lines followed by silence
— i.e. silence beginning at the first role that was **not** busy and therefore
took the wake-delivery path. A wedged tmux server here still blocks the cycle with
no bound and, because it never reaches the chokepoint, **no `subprocess-timeout`
line at all** — the precise silent-stall shape BL-967 exists to eliminate.

### D1b — `swarmforge/scripts/master_checkout_drift_lib.bb:180`
```clojure
(defn- run-git [project-root args]
  (let [res (process/sh (into ["git" "-C" (str project-root)] args))]   ; UNBOUNDED
    ...))
```
Reached from the heavy bundle every heavy cycle:
`run-sweep! "master-checkout-drift-sweep"` (`handoffd.bb:3300`) →
`master-checkout-drift-sweep!` (`:2117`) →
`master-checkout-drift-lib/check-master-checkout-drift!` → `run-git`, once per
daemon-executed script. These are `git` calls against the **shared master
checkout** — the chronically-contended tree the daemon itself merges and pushes
in the same bundle. A stale `index.lock` or a slow object read blocks unbounded.

**Remediation (fix the class, not the instance)**: route both through
`daemon-cycle-guard-lib/sh!`, exactly as `handoffd.bb`'s `tmux!` and
`handoff_lib.bb`'s seven sites were. Both files need the guard-lib `load-file`
— the same two lines already added to `briefing_email_lib.bb` and
`control_plane_lib.bb`.

---

## D2 — invariant 1's structural half is unencoded, and its stated reason is falsified
**Class**: `invariant-unencoded` · **Blamed**: coder

`daemon_cycle_guard_lib_property_runner.bb` states, as its reason for not encoding
the routing half of invariant 1:

> *"The remainder of the invariant — that the DAEMON routes every in-cycle
> subprocess through this chokepoint — is wiring over ~60 call sites, not a pure
> module: **held structurally (handoffd.bb and its in-cycle libs define no other
> subprocess path**; the clojure.java.shell require is gone from handoff_lib.bb)"*

D1 disproves that premise: two in-cycle libs *do* define another subprocess path.
A stated non-encodability reason that rests on a false structural claim leaves the
invariant with no gate at all — nothing in this parcel would have caught D1, and
nothing will catch the next sweep that reintroduces one.

**Remediation**: add a cheap structural test asserting that, over the **transitive
`load-file` closure from `handoffd.bb`**, no file outside `daemon_cycle_guard_lib.bb`
itself references `process/sh` / `process/process` / `clojure.java.shell`. Compute
the closure — do **not** hand-maintain a file list; a hand list gets patched one
name at a time and re-drifts (that is how D1 arrived). This is the gate that makes
the stated reason true instead of hopeful.

---

## D3 — the DRY extraction was inserted mid-sentence, splitting the BL-252 comment
**Class**: `readability` · **Blamed**: cleaner

`swarmforge/scripts/handoffd.bb:2176-2207`. `node-tool-path`/`node-tool-line` were
inserted **inside** the pre-existing BL-252 comment block. The block now ends
mid-sentence:

> `;; latter silently drops :dir (see auto-route!'s own comment above). Any`

and an orphaned fragment is left attached to `suite-duration-briefing-line`:

> `;; failure (CLI not yet compiled on this checkout, etc.) degrades to`
> `;; omitting the line entirely - never crashes the sweep, never a fabricated value.`

Separately, the surviving instruction *"Must use the `[cmd & args]` + opts-map form
of `process/sh`, not flat varargs — the latter silently drops `:dir`"* now sits
above a function that no longer shells at all. That hazard moved into
`node-tool-line`, and the warning should move with it.

The extraction itself is good and worth keeping — this is about where it landed.
**Remediation**: move the BL-967 comment + both defns clear of the BL-252 block,
restore BL-252's sentence, and relocate the `:dir` warning to `node-tool-line`.

---

## D4 — stale bound in the step file's Background comment
**Class**: `readability` · **Blamed**: coder

`specs/pipeline/steps/bl967HandoffdCycleStallSteps.js:158` still reads
*"with the wait bound at 500ms, a bounded cycle must land well inside this"*, but
`WAIT_BOUND_MS` was raised to `5000` (line 55, with its own comment explaining the
raise). Trivial, but it is the one number a reader checks the budget against.

---

## Checks run — everything else PASSED

| Check | Result |
|---|---|
| Dependency-rule gate (BL-259, **hard gate**) | RUN. Only the pre-existing `out/tools/telegram*` `acyclic` cycle. Verified pre-existing: the edges exist at `origin/main` and this parcel touches **no** telegram file. **Not a BL-967 defect.** |
| Co-change coupling (BL-255) | RUN, informational. Top coupling (`specs/pipeline/steps/index.js` 71, `briefing_email_lib.bb` 21, `chase_sweep_lib.bb` 18, `handoff_lib.bb` 16) is the expected daemon/lib/step-registry cluster; all co-changed here or untouched by design. |
| Invariant 1 property test — exists? | YES — `daemon_cycle_guard_lib_property_runner.bb` P1, real children. |
| Invariant 1 — **non-vacuity re-proven by me** | YES. Bound ×1000 in a scratch copy → hung child `elapsed=30034ms exit=0 fired=nil` (predicate fires). Real lib → `elapsed=173ms exit=124 fired={:context "probe-sweep" :cmd ["sleep" "30"] :bound-ms 150}`, child tree destroyed. |
| Invariant 2 property test — exists? | YES — P2, incl. the every-prefix-cut localization property. |
| Invariant 2 — **non-vacuity re-proven by me** | YES. Boundary emission made conditional on a truthy thunk → **125 failures / 180 runs**. |
| Property + unit runners | `PROPERTY_RUNS=200` → ALL PROPERTIES HOLD; unit runner ALL PASS. |
| Acceptance scenarios 01–04 | **4/4 pass** against the REAL `handoffd.bb` in a fixture root (47 s). Step handlers drive the real daemon, not a reimplementation. |
| `sh!` drop-in compatibility | Verified live across all three call shapes (varargs / vec+opts / opts-first): `:out` and `:err` are `String`, `:dir` honored, non-zero exit returned not thrown. |
| Fail-closed under a bounded timeout | Audited. `qa-ancestor?` exit 124 → `:ok? false`; `ahead-commit-facts` nil paths → `:ok? false` → `facts-complete? false` → push refused. **No fail-open introduced** by turning hangs into failed results. |
| Invariant 2 bundle completeness | All **22** heavy-bundle sweeps wrapped in `run-sweep!`; every pre-existing `<name>-error` event name preserved exactly. `KNOWN_VALUES` list in the step file matches. |
| `with-pid-lock` 30 s deadline | Correct — throws only *before* acquiring, so the `finally` never deletes a lock it does not hold. |
| Architecture rules | PASS. No TS/webview/secrets/browser-storage surface touched; two-layer boundary intact (tmux remains the substrate, nothing spawns agents from TS); `swarmforge/` maintained-fork policy respected. |
| My own property-coverage pass | The only touched **pure** module is `daemon_cycle_guard_lib.bb`, already covered by P1/P2 above. **No new property warranted** — stated rather than manufactured. |

No check was blocked.

---

## Bounce disposition
Bounced to **coder** (earliest blamed role, D1/D2). D3 is the cleaner's to clear as
the inventory travels back through it. BL-967's two commits (`95eebfcbf`,
`ac342019e`) are reverted out of `swarmforge-architect` in the same step
(BL-490/BL-495); the revert is **scoped to BL-967's own commits**, never
`-m 1` on the review merge, which would also revert the entangled sibling work
(BL-571 / BL-910 / BL-957 / BL-958 / BL-959 / BL-960) that rode in on the same
cleaner tip.
