# BL-960 — architect review pass 1: complete inventory

- **Ticket**: BL-960 heal wrapper parse-safe round-trip (`type: defect`, `severity: medium`)
- **Commit reviewed**: `68721df5d9` (cleaner) — merged as `1dfb82165`
- **Reviewer**: architect, 2026-08-19
- **Verdict**: BOUNCE to coder — 1 defect (D1), a declared-invariant violation.

Article 4.4 complete-inventory pass: every check below was run before sending.
This parcel is otherwise strong work — see the inventory.

---

## D1 — `single-simple-command?` does not exclude `#`, so the missing-root append lands inside a comment

- **Class**: `behavior`
- **Blamed role**: coder
- **Declared invariant violated**: #3 — *"A heal rewrite is applied only where its
  target is well-defined for the command's actual shape; where it is not (e.g.
  `:missing-root-argv` over a pipeline or `;`-sequence), the failure returns as-is —
  a syntactically valid but misdirected re-run is a defect, not a heal."*

### What is wrong

`single-simple-command?` (`swarmforge/scripts/tool_miss_heal_lib.bb:125`) gates the
`:missing-root-argv` append on:

```clojure
(not (re-find #"[|;&<>()`\n\\]" c))
```

`#` is absent from that class. A command carrying a trailing comment is therefore
classified single-and-simple, and the synthetic argument is appended **after the
comment marker**, where bash never passes it to the program.

### Reproduction (run, not reasoned)

```
$ bb -e '(load-file "swarmforge/scripts/tool_miss_heal_lib.bb")
         (let [cmd "node tool.js # BL-960 note"]
           (println (tool-miss-heal-lib/single-simple-command? cmd))
           (println (pr-str (tool-miss-heal-lib/healed-command :missing-root-argv cmd "/pinned/root"))))'
true
"node tool.js # BL-960 note \"$__sfh_root\""
```

The heal fires, produces valid bash, and the re-run is byte-equivalent in effect to
the original — the pinned root is swallowed by the comment. The append target was
not well-defined for this shape, which is precisely the condition under which
invariant 3 requires the failure to return as-is.

### Why the existing property did not catch it

The invariant-3 property builds its multi-command siblings from
`BL960-SEPARATOR-POOL` = `["; " " && " " | " "\n"]`
(`tool_miss_heal_lib_property_runner.bb:401`). The comment shape is outside that
corpus entirely, so the property is green while the gate leaks. This is the same
"the corpus omits the shape that slips through" gap the ticket itself was filed
against — the live defect was found in production, not by the suite.

### Consequence

Bounded but real: one wasted retry — the single retry BL-913's invariant 1 allows —
that cannot possibly succeed, after which the real failure is returned. No
misdirection onto a wrong program (that class is correctly gated), no data loss.
Severity is below the original defect, but it is a declared invariant that does not
hold, in a hook that rewrites **every** Bash command **every** role issues.

### Remediation

Add `#` to the exclusion class:

```clojure
(not (re-find #"[|;&<>()`\n\\#]" c))
```

This matches the gate's own stated conservative posture (declining to heal is always
safe; healing the wrong target is not). It over-declines for a quoted `#`
(e.g. `foo "a#b"`), which is the correct direction for this gate.

Then extend `BL960-SEPARATOR-POOL` (or add a dedicated shape) so the property
actually covers a trailing comment — otherwise the fix lands untested by the very
property that declares the invariant.

---

## Checks run — full inventory

| # | Check | Result |
|---|---|---|
| 1 | Merge lineage (`68721df5d9` ancestor of HEAD) | PASS |
| 2 | Bounced BL-571 + BL-958 content kept out of the merge | PASS — sender's branch still carries both; registry conflict resolved to `bl827` + `bl960` only, their step files correctly absent, registry verified to load |
| 3 | **Dependency gate (hard gate)** | PASS for this parcel — only the pre-existing BL-759 `telegram-*` `acyclic` cycle; no parcel file is in it |
| 4 | `required_wiring` — `swarmforge.sh::"PreToolUse": [` | PASS — 1 occurrence; the hook registration is genuinely restored, and the wiring test asserts it |
| 5 | Hook calls the SAFE wrapper, not the raw builder (BL-419 shape) | PASS — `tool_miss_heal_hook.bb:47` calls `safe-wrapper-command` only; `build-healing-wrapper-command` appears nowhere but a comment |
| 6 | Fail-open is silent and byte-untouched | PASS — `nil` from the parse gate routes to the same `pass-through!` no-op every other case uses; no narration on any stream |
| 7 | Parse gate cannot throw | PASS — `wrapper-parses?` catches everything to `false`; `safe-wrapper-command` also wraps the injected seam in its own try |
| 8 | Invariant 1 — every handed-back command parses | PASS — property + executable non-vacuity check A |
| 9 | Invariant 2 — wrapping observationally invisible when no heal fires | PASS — property compares exit code, combined output (trailing bytes included) and file side effects; executable non-vacuity check B reproduces the pre-fix `$()` trailing-newline strip |
| 10 | Invariant 3 — rewrite only where the target is well-defined | **FAIL — D1** (holds for `;`/`&&`/`\|`/newline; leaks on `#`) |
| 11 | Property tests exist + non-vacuous for all 3 declared invariants | PASS — and notably the non-vacuity checks are **executable every run**, not hand-verified once; stronger than this project's usual bar |
| 12 | `tool_miss_heal_lib_test_runner.bb` | PASS — ALL TESTS PASS |
| 13 | `tool_miss_heal_lib_property_runner.bb` (full 150 runs) | PASS — ALL PROPERTIES HOLD, all four non-vacuity checks confirmed |
| 14 | `test_tool_miss_heal_hook_wiring.sh` | PASS — ALL SCENARIOS PASS, including hook re-registration and the heredoc-with-paren shape |
| 15 | `bl960_heal_wrapper_acceptance_runner.bb` | PASS — payload-driven (`argv[1]` JSON); verified `roundtrip` mode returns `parses/exitIdentical/outputIdentical/filesIdentical` all true. (A bare argument-less run exits 1 on `case` with no default; that is an invalid invocation, not a defect.) |
| 16 | Scenario Outline validated against explicit KNOWN_VALUES | PASS — `<shape>` column mapped, mutated cell fails loudly |
| 17 | Step handler registered in `specs/pipeline/steps/index.js` | PASS |
| 18 | Secrets never written to the target tree | PASS |
| 19 | Two-layer boundary / host owns I/O / no webview storage | PASS — swarm machinery only, no extension or webview code |
| 20 | Policy independent of IO/UI/filesystem | PASS — `pinned-worktree` is an explicit parameter; no ambient `cwd`/env read inside the lib; the single subprocess boundary (`bash -n`) is isolated and injectable as a seam |
| 21 | Architect property-coverage pass (undeclared properties) | No new property added — the three declared invariants already carry properties with executable non-vacuity, and D1's remediation is itself a corpus extension the coder should own rather than something I bolt on beside a defect I am bouncing |

## Bookkeeping note (not part of this bounce)

The ticket YAML is at `backlog/paused/BL-960-…yaml`, not `backlog/active/`, while the
parcel is in flight. `record-bounce.js` only searches `backlog/active/<TICKET>-*.yaml`,
so this bounce was written to the durable JSONL log but could not be merged into the
ticket's own `bounce_history` automatically; the entry was added by hand in the
paused-location file, matching the shape `record-bounce.js` would have written. This is
the same shape observed on BL-935 earlier today. Coordinator bookkeeping, not this
review's scope — flagged because it is why the automated merge degrades.

---

## Additional finding — this review branch had silently lost the operator's hook disable

Not a BL-960 defect (it predates this parcel), but safety-critical and surfaced
here because the bounce revert ran straight into it.

`main` carries the operator's 2026-08-19 decision (`3bac496ec`) disabling the
`PreToolUse` hook — `"hooks": {}` plus a standing directive: *"Re-enable ONLY once
the wrapper is parse-checked (bash -n) with fail-open to the untouched original."*

That commit **is** an ancestor of this branch, but its **content was not present**:
`swarmforge/scripts/swarmforge.sh` here still carried BL-913's live `"PreToolUse": [`
registration. A merge on this branch reinstated the enabled block over the disable
with no conflict marker — the same ancestry-is-not-content trap BL-952/BL-954 record.
The divergence was exactly and only that block (17 insertions / 10 deletions).

Left alone, reverting BL-960 would have restored the *pre-fix* lib while leaving the
hook **enabled** — precisely the broken combination the operator switched off after it
stalled QA for 50 minutes. Since BL-960's fix is being bounced, the hook must stay off.

Action taken: `swarmforge/scripts/swarmforge.sh` restored to `main`'s version, so this
branch again matches the operator's standing decision. Nothing else in that file
differed, so nothing else was affected. `main` itself was always correct and was not
touched.

---

## D1 remediation (coder, 2026-08-19, pass 1 re-fix)

`#` added to `single-simple-command?`'s exclusion class exactly as the
remediation prescribes (quote-blind, over-declines a quoted `a#b` — the
safe direction for this gate). Corpus extended so the fix is not untested
by its own invariant: `BL960-SEPARATOR-POOL` gains `" # "`, deriving the
trailing-comment sibling by construction on every draw; unit runner gains
the comment gating cases (single-simple false, healed-command nil).
Red-then-green: with the gate unfixed, the new unit cases and the
invariant-3 property both failed on `node cli.js # true` (seed 7); green
after the one-character class fix. Full lanes green at the re-fix commit:
lib runner ALL TESTS PASS, property runner ALL PROPERTIES HOLD (150 runs,
non-vacuity A/B/C confirmed), wiring ALL SCENARIOS PASS, acceptance
BL-960 10/10, BL-913 6/6, BL-934 3/3.
