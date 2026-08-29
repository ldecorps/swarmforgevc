# BL-1261 QA Bounce — 20260829

## Commit under test
`2c7867e770` (merge of documenter's `c4039347e` into `swarmforge-documenter`,
already an ancestor of my `swarmforge-QA` tip). Ancestry confirmed: coder
`1b2b80589`, architect `65c70421c`, hardener `d02d33083`, documenter
`c4039347e` are all ancestors of my current worktree tip.

## Full inventory (Article 4.4 — one bounce, complete checklist)

### D1 — how-to's "Verify" block: both hand-run commands are broken as written

**`docs/how-to/BL-1261-hold-divergence-audit.md`, "Verify" section (lines
52-61)** gives three commands; two of the three do not do what the doc
claims.

1. **Failing command 1**: `bb swarmforge/scripts/hold_divergence_audit_cli.bb`
   (exactly as documented, no arguments).
   - **Commit hash tested**: `2c7867e770`.
   - **First error excerpt**: no error — worse, a *silent* no-op:
     ```
     Usage: hold_divergence_audit_cli.bb <backlog-root>

     Audit for divergence between backlog/hold/ and live parcels.
     Reports tickets in hold/ that have parcels still moving in role mailboxes.
     Report only - never moves tickets or parcels.
     ```
     exits **0**. The CLI's own `-main` (`hold_divergence_audit_cli.bb:9-16`)
     treats an empty arg list as a help request and exits before running the
     audit at all — confirmed by reading the source (`(when (or (empty? args)
     ...) (println "Usage: ...") (System/exit 0))`). A reader following the
     how-to gets a clean exit and no error, and would reasonably believe the
     audit ran and found nothing — it never ran.
   - **Failure class**: `behavior`.
   - **Expected vs observed**: Expected the command to run the audit against
     the current repo (the doc's own text says "Run the audit by hand").
     Observed: the CLI requires a `<backlog-root>` positional argument (per
     its own usage banner and its own comment, `;; Usage:
     hold_divergence_audit_cli.bb <backlog-root>`); the documented command
     omits it.

2. **Failing command 2**: `cd extension && npx vitest run bl1261HoldDivergenceAudit`
   (exactly as documented).
   - **Commit hash tested**: `2c7867e770`.
   - **First error excerpt**:
     ```
     No test files found, exiting with code 1
     filter: bl1261HoldDivergenceAudit
     include: **/*.{test,spec}.?(c|m)[jt]s?(x)
     exclude:  ... **/*.property.test.js
     ```
   - **Failure class**: `behavior`.
   - **Expected vs observed**: Expected the property test file to run.
     Observed: exit 1, no test files found — the default `vitest run`
     config explicitly excludes `**/*.property.test.js` (visible in the
     command's own output), and the doc's filter string
     (`bl1261HoldDivergenceAudit`) doesn't match the actual file's basename
     either (`bl1261HoldDivergenceAudit.property.test.js` — filter would
     need the full name or a substring vitest actually resolves against the
     path, and even then the property-config flag is still required). The
     project's own engineering rule (`local-engineering.prompt` /
     `engineering.prompt` "Test Speed And Isolation") requires property
     tests to run via their own command, `npm run test:properties`
     (`vitest.properties.config.mjs`) — the correct invocation is `cd
     extension && npx vitest run --config vitest.properties.config.mjs
     test/bl1261HoldDivergenceAudit.property.test.js`, verified working:
     3/3 pass.

   The third command in the same block (`node specs/pipeline/cli.js
   specs/features/BL-1261-hold-divergence-audit.feature`) DOES work as
   written — 9/9 acceptance scenarios pass. Only the first two are broken.

**Root cause**: the documenter wrote convenience "run it by hand" commands
without actually running them before publishing — same category of miss as
this session's `BL-1245` bounce (docs asserting a working procedure that
isn't the one the shipped code takes).

**Remediation pointer**: `docs/how-to/BL-1261-hold-divergence-audit.md`
lines 52-57 — command 1 needs a backlog-root argument (e.g. `bb
swarmforge/scripts/hold_divergence_audit_cli.bb .` run from repo root, or
whatever root the project's convention uses elsewhere in this doc); command
2 needs `--config vitest.properties.config.mjs` and the real file path
`test/bl1261HoldDivergenceAudit.property.test.js`.

**Blamed role**: `documenter` — both commands are the documenter's own new
content in `c4039347e`.

## Rest of the checklist — no other defects found

- **Acceptance** (`node specs/pipeline/cli.js
  specs/features/BL-1261-hold-divergence-audit.feature`, and via
  `run_acceptance.sh`): 9/9 scenarios pass.
- **Property suite** (correct invocation): 3/3 invariant properties pass
  (50 runs each) — audit-reports-only, unreadable-mailbox-fails-closed,
  batch-subdirectory-discovery.
- **required_wiring**: `hold_divergence_audit_cli.bb` is called from
  `promote_and_route_next.sh:490-491` (confirmed by grep, guarded by a
  file-existence check); `bl1261HoldDivergenceAuditSteps` registered in
  `specs/pipeline/steps/index.js:865`.
- **Live cross-check (qa_e2e_procedure item 6)**: ran `bb
  swarmforge/scripts/hold_divergence_audit_cli.bb .` (correct invocation)
  against the live repo → `CLEAN: no divergence detected`. Manually
  cross-checked: `backlog/hold/` currently holds exactly one ticket
  (`BL-472`, the original human hold), and grepping every role's
  `inbox/new` and `inbox/in_process` (including `batch_*`) for `BL-472`
  finds nothing — the CLEAN verdict is correct for current state. (The
  ticket's own notes flag this count as a moving target, not a pass
  criterion — consistent with what I found.)
- **Compile**: no `.ts` files touched by this ticket.
- **Ancestry**: coder → architect → hardener → documenter chain confirmed
  above, no wrong-commit risk.

## Disposition

Bounce to **documenter** (both defects are the documenter's own new
content in `c4039347e`, same pattern independently found in this session's
`BL-1245` bounce — worth the documenter treating as one class of miss
across both tickets, though this evidence file and handoff cover only
BL-1261's own instance).

By QA.
