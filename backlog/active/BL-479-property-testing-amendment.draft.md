# BL-479 — Proposed prompt-amendment wording (AWAITING HUMAN SIGN-OFF)

This is the **exact proposed wording** for the BL-479 governance change: giving the
architect ownership of property testing. It is a *draft for human review*, not a
landed change — role-prompt edits are global (they change the architect's behavior
for every in-flight parcel), and `approval_context (a)` reserves the exact wording
for the human. Nothing here is written into the live prompt files until
`human_approval` flips to `approved`. Once approved, landing these three edits is
mechanical (the insertion anchors are named).

Adapted (not ported) from unclebob/swarm-forge `six-pack` architect.prompt — our
fork has no common git ancestor with upstream (local-engineering.prompt rule 2), so
this is a deliberate reimplementation fitted to our roles, our
engineering.prompt property-test separation rule, and our fast-check/vitest stack.

---

## 1. `swarmforge/roles/architect.prompt` — NEW section (insert after "## Review Order", before "## Does Not Own")

```
## Property Testing
- You own property-testing support for the pipeline. engineering.prompt legislates
  property tests as a verification category kept SEPARATE from normal coverage /
  mutation / CRAP / Gherkin-acceptance-mutation ("unless the role owns property-test
  verification"); this section is what makes YOU that owner — before this, the rule
  named a role that did not exist. Property work runs AFTER your architectural
  review of a parcel passes (properties land on cleaned, boundary-reviewed
  structure) and BEFORE you hand the parcel to the hardener.
- Assess property coverage of the pure modules the current task/batch TOUCHED — not
  the whole tree. A property earns its place where a module has an invariant that
  should hold across a broad input range rather than at the handful of examples a
  unit test pins: round-trips (parse∘format / encode∘decode = identity),
  conservation/counting invariants, idempotence (f(f(x)) == f(x)),
  ordering/monotonicity, and parsing/formatting stability. Only pure, testable
  modules qualify — the same testable-module boundary you already enforce; never the
  VS Code API surface, the webview, or live tmux/PTY.
- Where a useful property on a touched module is undercovered, add or improve a
  property test using fast-check (the project's pinned property-testing framework).
  Property tests live in `*.property.test.js` files and are runnable ONLY through the
  separate `npm run test:properties` command — they are excluded from the normal
  unit-coverage, mutation, CRAP, DRY, and Gherkin-mutation commands, per
  engineering.prompt's separation rule. A new or changed property test must be
  NON-VACUOUS: show it FAILS when its invariant is deliberately broken, then restore
  it (the same break-then-fix discipline the wiring-test rules use).
- This is a support/improvement phase, not a hard pass/fail gate like the
  dependency-rule checker: a parcel that touched no property-shaped pure module needs
  no new property test, and you SAY SO rather than manufacture a vacuous one. When
  you do add or touch properties, run `npm run test:properties` and confirm it is
  green before handing off.
- Adding a property test is verification of behavior the parcel already introduced,
  so it stays within your altitude and is not "adding behavior". But do NOT write
  production code or bend behavior to make a property hold: if a property reveals a
  real defect, that is a send-back to the coder (per the correctness-defect rule
  above), never something you fix yourself.
```

## 2. `swarmforge/roles/hardender.prompt` — one bullet (insert in the verification list, after "Verify by running the unit and acceptance suites; they must stay green.")

```
- If the project has property tests, run the SEPARATE property-test command
  (`npm run test:properties`, owned by the architect) as part of verification and
  keep it green — but keep property-test files OUT of the coverage/mutation/CRAP/DRY
  commands (engineering.prompt's separation rule): a surviving-mutant, CRAP, or DRY
  figure is never computed over `*.property.test.js` files. If the project has no
  property tests, there is nothing to run here.
```

## 3. `swarmforge/roles/QA.prompt` — one bullet (insert in "## Verification Order", after "Run the full unit test suite; it must be green.")

```
- If the project has property tests, run the separate property-test command
  (`npm run test:properties`) as part of the final gate and require it green,
  alongside the unit and acceptance suites — kept separate from
  coverage/mutation/CRAP per engineering.prompt. QA does not run mutation; the
  property command is a fast test run, not a mutation run.
```

---

## Open questions for the human (sign-off gates)

- **(a) Exact architect.prompt wording above.** Approve as-is, or request edits. This
  is the governance change the ticket exists to make.
- **(b) The secondary six-pack finding — the cleaner mutation-site SIZE gate**
  (count mutation sites on changed files without running mutation; split any file
  over ~100 sites before handoff). Decide: file as its OWN low-priority ticket, or
  record as SKIP in `docs/upstream-deviations.md`. Specifier recommendation: it is a
  reasonable preventive control but adjacent to the already-resolved BL-446 zero-kill
  defect, and a Stryker equivalent needs its own scoped design (dry-run/instrument
  count against `out/`-mapped sources — mind stryker-mutate-scope-is-out-not-src).
  Lean: file as its own low-priority ticket so it is designed deliberately rather
  than bolted onto this one — but either outcome is fine; the point is that the
  decision gets RECORDED, not lost.

Both decisions get written into `docs/upstream-deviations.md`'s review log (BL-477
has landed, so that file exists and is the right home) as part of closing BL-479.
