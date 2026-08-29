# BL-1245 QA Bounce — 20260829

## Commit under test
`3401ce252` (merge of documenter's `e1bc21174a` into `swarmforge-QA`).
Ancestry confirmed: coder `fec02fcad`, coder property-test fix `35eefa6d8`,
hardener `5f657da95`, documenter `e75c5b126`, documenter merge `e1bc21174a`
are all ancestors of `3401ce252`, which is itself an ancestor of my current
worktree tip.

## Full inventory (Article 4.4 — one bounce, complete checklist)

### D1 — how-to guide and Specification.MD document a CLI syntax that fails

1. **Failing command**: `bb swarmforge/scripts/role_ask.bb <root> resolve
   specifier "a test reason"` — the exact invocation shown in
   `docs/how-to/BL-1245-role-reopens-its-own-question-slot.md` (`bb
   swarmforge/scripts/role_ask.bb resolve <role> "<reason>"`) and in
   `docs/reference/Specification.MD`'s BL-1245 changelog entry (identical
   positional form).
2. **Commit hash tested**: `3401ce252` (working tree at this commit).
3. **First error excerpt**:
   ```
   Usage:
     Ask mode:     role_ask.bb <project-root> --role <role> --question <q> [--options '["a","b"]']
     Resolve mode: role_ask.bb <project-root> --role <role> --resolve --reason <reason>
   ```
   (exit 1 — the documented positional `resolve <role> "<reason>"` form is
   not recognized at all; `role_ask.bb` only ever parses `--role`,
   `--resolve`, `--reason` as flags — confirmed by reading `role_ask.bb`
   itself: `(def ^:private boolean-flags #{"resolve"})` and
   `resolve-mode? (some? (:resolve opts))`, no positional dispatch exists
   anywhere in the file.)
4. **Failure class**: `behavior` (docs assert a working procedure; the
   procedure as written does not work — an intent/behavior mismatch, not a
   compile error).
5. **Expected vs observed**: Expected the how-to's copy-pasteable command to
   resolve the pending slot (per the ticket's own qa_e2e_procedure item 3,
   "resolve with a real reason"). Observed: a usage error and exit 1 — a
   role or human following the documenter's own new how-to guide cannot
   actually reopen their slot with the command given.

**Root cause**: the documenter wrote the how-to guide and the
Specification.MD changelog entry from the ticket description's prose
("`role_ask.bb`... a new verb") without checking the actual shipped
flag-based syntax the coder implemented and the acceptance/property tests
exercise (`--role <role> --resolve --reason <reason>`, e.g.
`extension/test/bl1245RoleReopensOwnSlot.property.test.js:86`:
`runRoleAsk(root, ['--role', role, '--resolve', '--reason', reason])`).

**Remediation pointer**: `docs/how-to/BL-1245-role-reopens-its-own-question-slot.md`
(the fenced `bash` block giving the resolve command) and
`docs/reference/Specification.MD` lines 21 (BL-1245 entry) — both need the
command rewritten to `bb swarmforge/scripts/role_ask.bb <project-root>
--role <role> --resolve --reason "<reason>"`.

**Blamed role**: `documenter` — both files are the documenter's own new
content in `e75c5b126`.

### D2 — specifier.prompt's stale manual-recovery prose was not replaced, though the ticket's own notes named this exact spot

1. **Failing command**: N/A (a content-currency check, not an executable
   command) — `grep -n -B2 -A10 "no-answer.*mismatch" swarmforge/roles/specifier.prompt`.
2. **Commit hash tested**: `3401ce252`.
3. **First error excerpt** (the stale prose, still present verbatim at
   `swarmforge/roles/specifier.prompt:233-241`):
   ```
   - **If it reports `no-answer` or `mismatch`, the answer never reached the
     store (BL-1245).** That happens when the human answered while the swarm was
     down: no bot ran, so nothing recorded it, and the CLI has nothing to pair.
     Verify by hand that you do have the answer (`backlog/answers-archive/`, or
     the reply in your own pane), then archive the marker OUT of
     `role-awaiting/` — `operator_runtime.bb` scans that directory for `*.json` —
     e.g. to `.swarmforge/operator/role-awaiting-archive/<role>-<date>-answered.json`.
     Never delete it: ... File the answer in `backlog/answers-archive/`, then re-ask.
   ```
4. **Failure class**: `behavior` (docs describe retired manual procedure as
   current guidance; the mechanism it describes is now superseded).
5. **Expected vs observed**: Expected `specifier.prompt` to point the
   specifier at the new `--resolve --reason` verb, per the ticket's own
   note: *"the manual recovery is written into swarmforge/roles/specifier.prompt
   so the next role to hit this has a move before the verb exists (BL-798 -
   that prose is mine and landed with this mint). **Replace it with the
   resolve command when this ships.**"* Observed: the prose is unchanged
   from before this ticket — still the by-hand
   verify-and-move-the-file-yourself procedure, no mention of `role_ask.bb
   --resolve`.

**Root cause**: the documenter's pass (`e75c5b126`) added new docs
(how-to, Specification.MD, docs/index.md link) but did not touch
`swarmforge/roles/specifier.prompt`, despite the ticket's own notes
explicitly naming that file and this exact paragraph as needing
replacement once the verb shipped.

**Remediation pointer**: `swarmforge/roles/specifier.prompt` lines
~233-241 — replace the by-hand archive procedure with the `--resolve
--reason` command (once D1's correct syntax is fixed, reuse it here).

**Blamed role**: `documenter` — same pass, same file category (docs), a
named deliverable this ticket's own notes called out.

## Rest of the checklist — no other defects found

- **Acceptance** (`specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1245-role-reopens-its-own-question-slot.feature`): 6/6
  scenarios pass.
- **Shell unit suite** (`bash swarmforge/scripts/test/test_role_ask.sh`):
  ALL PASS, including all 4 new BL-1245 cases and every pre-existing
  scenario (GH-26 undeliverable-drop path unchanged, per-role pending
  guard unchanged).
- **Property suite** (`npx vitest run --config vitest.properties.config.mjs
  test/bl1245RoleReopensOwnSlot.property.test.js`): 3/3 invariant
  properties pass, 50 randomized runs each, driving the real CLI via
  `execFileSync` (not a JS reimplementation) — addresses the architect's
  original bounce (`0ed8d8a56`) for real; not vacuous (each assertion would
  fail if the corresponding invariant broke).
- **Compile**: no `.ts` files touched by this ticket; `npx tsc --noEmit`
  already verified clean during the same session's BL-1262 pass.
- **required_stages**: coder, cleaner, architect (bounced once, then
  passed), hardender, documenter all present in history; ancestry verified
  above.
- Bundled in the same commit (`e1bc21174a`, not this ticket's own scope):
  documenter also retired BL-1197 as subsumed by BL-1194. Not bounced —
  BL-1194's underlying code fix (`other-holders` in
  `backlog_hygiene_lib.bb`) is already present and content-complete in this
  worktree (documenter-passed at `7efb049bb`, also an ancestor of my tip),
  so the retirement's premise holds even though BL-1194's own ticket
  bookkeeping hasn't reached `done/` yet. Flagged for the record, not
  blocking BL-1245.

## Disposition

Bounce to **documenter** (both defects are the documenter's own new-or-owed
content from `e75c5b126`). Not a coder defect — `role_ask.bb`'s actual
implementation, and the tests exercising it, all agree with each other and
are correct; only the prose describing it is wrong.

By QA.
