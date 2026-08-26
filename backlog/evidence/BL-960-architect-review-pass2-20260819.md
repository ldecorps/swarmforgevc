# BL-960 — architect review pass 2 (re-fix): complete inventory

- **Ticket**: BL-960 heal wrapper parse-safe round-trip (`type: defect`, `severity: medium`)
- **Commit reviewed**: `d20162a511` (cleaner re-fix)
- **Reviewer**: architect, 2026-08-19
- **Prior bounce**: pass 1, `68721df5d9`, class `behavior` —
  `backlog/evidence/BL-960-heal-wrapper-parse-safe-round-trip-bounce-20260819.md`
- **Verdict**: **PASS — D1 closed, defects found: NONE.**

## D1 is closed, and I proved it twice: the fix, and the test that would have caught it

Pass 1's D1: `single-simple-command?` omitted `#` from its exclusion class, so a
command with a trailing comment was classified single-and-simple and the
`:missing-root-argv` append landed **inside the comment** — valid bash, inert heal,
one guaranteed-wasted retry. Declared invariant 3 ("a rewrite is applied only where
its target is well-defined") did not hold.

Both halves of the remediation I asked for were delivered.

**Half 1 — the gate.** `tool_miss_heal_lib.bb:132` now reads
`#"[|;&<>()`\n\\#]"`. Re-running my pass-1 reproduction verbatim:

```
"node tool.js # BL-960 note" -> simple? false | healed: nil
"node tool.js"               -> simple? true  | healed: "node tool.js \"$__sfh_root\""
"foo \"a#b\""                -> simple? false | healed: nil
```

The defect shape now declines, the healthy shape still heals, and the quoted `a#b`
over-declines — the safe direction, as the gate's own conservative posture requires.

**Half 2 — the corpus, and I broke it myself rather than trust it.** A fix landing
untested by the very property that declares the invariant was the second half of my
remediation. `BL960-SEPARATOR-POOL` now carries `" # "`. Green alone proves nothing, so
I copied lib + runner to a scratch tree, removed `#` from the exclusion class (exactly
the pre-fix state), and re-ran:

```
FAIL BL-960 invariant 3: the single-simple base still carries the missing-root heal ...
  input: {:base "node cli.js --flag value", :derived "node cli.js --flag value # echo \"---done---\""}
  the derived multi-command wrapper still appends the root
EXIT=1
```

The extended corpus **bites on exactly my D1 shape**. Scratch copy removed; the
worktree was never modified.

## The stricter gate cannot regress anything else

Widening an exclusion class makes a predicate decline more often, which is only safe
if every caller treats "decline" as harmless. `single-simple-command?` has exactly
**one** non-test caller — `healed-command`'s `:missing-root-argv` branch
(`tool_miss_heal_lib.bb:146`) — where declining yields `nil`, no heal, and the real
failure returned as-is. That is precisely what invariant 3 prescribes, so the strictness
increase has no other reachable consequence.

## The hook re-enable is operator-authorized — I checked, I did not assume

This parcel restores the `PreToolUse` registration the operator disabled the same day
(`3bac496ec`) after it stalled QA for 50 minutes. A parcel re-enabling a
safety-disabled hook that rewrites **every** Bash command **every** role issues is not
something to wave through on a commit message, so I verified the authority on the
ticket itself rather than in the diff:

- `backlog/active/BL-960-…yaml` carries `human_approval: approved`.
- The operator was asked and replied verbatim: **"reenable the ho9k after 960"**, with
  the ticket recording that the restoration is *confirmed, not merely inferred*.
- The disable comment's own stated condition — *"Re-enable ONLY once the wrapper is
  parse-checked (bash -n) with fail-open to the untouched original"* — is met and
  independently verified below (checks 6–8, 14).

The re-enable therefore rides the correct parcel, with the correct authority. Note for
the stages after me: BL-960's own ticket asks that the settings files be confirmed to
carry the hook again *after* landing, which is a QA/operator step, not this review's.

## Checks run — full inventory

| # | Check | Result |
|---|---|---|
| 1 | Merge lineage (`d20162a511` ancestor of HEAD) | PASS |
| 2 | Registry conflict resolved to the union, not a drop | PASS — `bl571` + `bl958` + `bl960`, all three step files present, `require` of index.js returns a live `registerSteps` |
| 3 | **Re-fix not silently suppressed by my own bounce revert (BL-954 trap)** | PASS — merged tree is byte-identical to the sender's tip across `swarmforge/`, `specs/`, `extension/` (empty `git diff d20162a511 --`) |
| 4 | **D1 remediation present AND effective** | PASS — pass-1 reproduction re-run, now declines |
| 5 | **D1's test would now catch it** (my second remediation half) | PASS — break-then-fix: removing `#` fails invariant 3 on the comment shape |
| 6 | `required_wiring` — `swarmforge.sh::"PreToolUse": [` | PASS — 1 occurrence |
| 7 | Hook calls the SAFE wrapper, not the raw builder | PASS — `tool_miss_heal_hook.bb:47` calls `safe-wrapper-command`; the raw builder appears only in a comment |
| 8 | Hook re-enable is operator-authorized | PASS — `human_approval: approved` + verbatim operator instruction on the ticket |
| 9 | Stricter gate has no unsafe call site | PASS — one caller; decline == invariant 3's required behavior |
| 10 | Invariant 1 — every handed-back command parses | PASS — property + executable non-vacuity A |
| 11 | Invariant 2 — wrapping observationally invisible | PASS — property + executable non-vacuity B |
| 12 | Invariant 3 — rewrite only where the target is well-defined | **PASS — was the pass-1 failure; now gated by unit case, property corpus, and proven non-vacuous** |
| 13 | `tool_miss_heal_lib_test_runner.bb` | PASS — ALL TESTS PASS, incl. 3 new BL-960-D1 cases |
| 14 | `tool_miss_heal_lib_property_runner.bb` | PASS — ALL PROPERTIES HOLD, non-vacuity A/B/C all confirmed |
| 15 | `test_tool_miss_heal_hook_wiring.sh` | PASS — ALL SCENARIOS PASS, incl. fail-open, heredoc-with-paren, and hook re-registration |
| 16 | `bl960_heal_wrapper_acceptance_runner.bb` | PASS — `roundtrip` returns parses/exitIdentical/outputIdentical/filesIdentical all true |
| 17 | Scenario Outline validated against explicit KNOWN_VALUES | PASS — `KNOWN_SHAPES` map; a mutated Examples cell fails loudly |
| 18 | **Dependency gate (hard gate)** | RED repo-wide, **not attributable to this parcel** — see below |
| 19 | Co-change coupling | Informational, no gap — the coupled set moved together |
| 20 | Two-layer boundary / secrets / host owns I/O / no webview storage | PASS — swarm machinery only |
| 21 | Policy independent of IO/UI/filesystem | PASS — `pinned-worktree` stays an explicit parameter; the single subprocess boundary (`bash -n`) is isolated behind an injectable seam |
| 22 | Architect property-coverage pass (undeclared properties) | No new property required — all three declared invariants carry properties whose non-vacuity is asserted on **every run**, which is above this project's usual bar |

### Check 18 — the gate is RED, and it is BL-759's, not BL-960's

`node extension/out/tools/dependency-gate.js` (full-repo, the only honest invocation —
scoped repo-relative paths resolve against `extension/` and fail to open) exits 1 on
three `acyclic` edges among `src/tools/telegram*`. Attribution before blame: this
parcel's merge touches **zero** telegram files, and the cycle is already ticketed as
**BL-759** (`backlog/paused/`). Pre-existing, owned, unchanged by this parcel — **not a
defect of BL-960 and not a bounce**, and nothing new to surface.

### Check 19 — co-change

`co-change-report.js tool_miss_heal_lib.bb swarmforge.sh` ranks the unit runner (5),
`index.js` (4), the property runner (4), `swarmforge.sh` (3), the wiring test (3), and
`tool_miss_heal_hook.bb` (3). Every one of those moved with the parcel. No coupled file
that should have moved stayed still.

## Verdict

**PASS.** Defects: **NONE.** D1 is closed at both the code and the test level, proven by
re-running my own reproduction and by breaking the new corpus to show it bites. The
hook re-enable carries explicit operator authority. The sole hard-gate failure is
BL-759's pre-existing cycle, which this parcel neither caused nor touches. Forwarding
to the hardener under the same task name.
