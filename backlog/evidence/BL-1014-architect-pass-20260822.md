# BL-1014 architect pass — 2026-08-22

**Parcel:** cleaner forward `8274108c3d` ("BL-1014: split boyScoutScan.ts
along its policy/IO seam (BL-485 mutation-site size)"), merged into
architect at `5eba63306`. Cleaner split the coder's single-file
implementation (`6107c5103`, "BL-1014: Boy Scout slice 1 — a read-only scan
that ranks debt by recurrence") behavior-preservingly into
`extension/src/tools/boyScoutScan/{types,rank,parsers,report,readers,scan,index}.ts`.
Cross-checked `git diff` against both merge parents: additive only, no
unexpected deletions either direction (the only non-additive lines are two
architect evidence files from the prior BL-1010/BL-1011 passes, already
mine).

**Verdict: PASS.** Complete review inventory below records **NONE** — no
architecture violation, no invariant violation, no correctness defect in
the parcel's own changed code. One spec-gap item, routed by note (below),
not a bounce.

## Review completed first (Article 4.4 — full inventory before judging)

- **Two-layer / extension-host boundary:** N/A for the core design — this
  is a standalone CLI tool under `extension/src/tools/`, matching its
  sibling BL-820 closing-ceremony CLI and record-bounce, not VS Code
  webview/extension-host code. No `vscode` API import anywhere in the
  module (grepped, zero matches).
- **Policy/IO seam:** genuinely respected, not just claimed. `rank.ts`,
  `parsers.ts`, `report.ts` are pure over already-read data; `scan.ts` wires
  them through an injected `SourceReaders` seam; `readers.ts` is the only
  IO and only reads (`fs.readFileSync`/`readdirSync`/`execFileSync`, no
  write calls anywhere in the module — grepped). `index.ts`'s `main()` is a
  thin CLI wrapper (resolve root, call `scan`, print) per the engineering
  rule.
- **Dependency-rule hard gate (BL-259):** `node extension/out/tools/dependency-gate.js`
  over all 7 changed files → **PASSED: no forbidden edges.**
- **Co-change coupling (BL-255):** ran `node extension/out/tools/co-change-report.js`
  over all 7 changed files. Every pair shows exactly 1 co-change (the
  single split commit) — well under the tool's default suspicion threshold
  of 3, and expected: these files were born together in one refactor.
  Nothing to report.
- **Integrate-not-fork:** the ledger reader shells out to the EXISTING
  `swarmforge/scripts/hardening_debt_ledger_read.bb` rather than parsing
  the YAML directly, per that ledger's own header and this ticket's
  `required_wiring`. No SwarmForge source touched or copied.
- **Declared invariant 1 (deterministic):** `rank.ts`'s `rankInventory` sort
  is a total order over the data itself (source count, then evidence
  count, then subject string) — no clock, no `Math.random`, no
  Map-insertion-order dependence (grepped for both; zero matches in the
  module). Encoded as P1 in `boyScoutScan.property.test.js`, which
  constructs exact ties BY DESIGN and asserts forward-vs-reversed-input
  produces identical rankings (200 runs, ties reached ≥40 times per its own
  coverage floor) — this is the right shape of property, since a stable
  sort bug only shows at ties or under input-order variation, which a
  single re-run can't catch. Live-ran the CLI against this actual
  repository twice in succession: byte-identical output both times
  (`diff` empty).
- **Declared invariant 2 (evidence-bearing):** every `Evidence` carries
  `artifact`+`detail`; property test P1/P2 assert this over BOTH synthetic
  generated evidence AND the real parsers' output (the property test's own
  authorship note documents a real vacuity hole it found and closed: the
  synthetic-only version passed even when a parser dropped its artifact
  pointer, because the generator always populated one by construction — P4
  now runs the same assertion through `parseHardeningLedger`/
  `parseCrapReport` directly). Independently spot-checked the acceptance
  step handler's scenario 03, which opens the cited artifact file by hand
  and confirms it contains the row the rank came from, not just that a
  string is non-empty.
- **Declared invariant 3 (read-only):** the property test builds a real
  temp tree, snapshots it (recursive dir listing + sizes), runs `scan`
  through both a clean and a throwing-reader path (broken sources reached
  ≥5/40 times per its own floor), and asserts the snapshot is unchanged
  either way — a broken source must not tempt a cache/placeholder write.
  Checked the one external-process reader specifically: `readers.ts`'s
  `readDuplicationReport` shells to `npx jscpd --config .jscpd.json`, and
  `.jscpd.json` pins `"reporters": ["console"]` (no file reporter) — ran it
  live from `extension/` and diffed a `find . -maxdepth 2` listing
  before/after: no new files or directories. Also confirmed live: ran the
  actual CLI (`node extension/out/tools/boyScoutScan/index.js .`) twice
  against this real repository and diffed `git status --short` before and
  after both runs — empty both times.
- **`required_wiring` entry 2** (`specs/pipeline/steps/index.js::bl1014`):
  the step file is registered (`require('./bl1014BoyScoutScanRanksDebtSteps')`
  present, grepped and confirmed by the passing acceptance run below).
- **`required_wiring` entry 1** — **SPEC GAP, not a code defect** (routed by
  note, see below): the entry still cites
  `extension/src/tools/boyScoutScan.ts` (the coder's original single-file
  path), which the cleaner's legitimate split removed. The underlying
  requirement (reach the ledger through its existing read CLI, never
  re-parse the YAML) IS correctly satisfied — now at
  `extension/src/tools/boyScoutScan/readers.ts` — but the ticket's own
  pinned path string is stale, and `pre_qa_gate_lib.bb`'s wiring gate
  resolves that literal path against `file_contents` at the cited commit.
  Left unedited, the documenter→QA handoff will hard-fail with
  `PRE_QA_GATE_FAIL wiring BL-1014 extension/src/tools/boyScoutScan.ts not
  found at cited commit`. Not a bounce: editing `required_wiring` is
  specifier territory (Article 1.2); this is the same shape as Article
  4.4's "a ticket instruction naming a commit not in the parcel" — here a
  ticket instruction naming a file path no longer in the parcel following
  a legitimate refactor. `note` sent to specifier + coordinator (priority
  `00`) with the suggested fix (repoint to
  `extension/src/tools/boyScoutScan/readers.ts`).
- **Correctness read, by hand:**
  - Subject normalization (`normalizeSubject`) is idempotent (`extension/src/a.ts`
    fed back in is left alone — tested explicitly) and applied consistently
    in both `parseCrapReport` and `parseDuplicationReport`, so the ledger
    (repo-relative) and CRAP/dry (extension-relative) keys actually
    corroborate — confirmed live: the real scan run above surfaced
    `extension/src/tools/telegram-front-desk-bot.ts` attested by both
    `deferred-hardening-gate` and `crap-over-threshold`, i.e. the
    corroboration working on real data, not just the fixture.
  - `mergeBySubject`'s `sourceCount` counts distinct `source` values via a
    `Set`, not row count — checked against the "chatty source" unit test
    and confirmed in the source itself.
  - `scan`'s `consult` helper records a thrown/unavailable source as
    `available: false` with its reason rather than silently shrinking the
    evidence list — checked both the crap/duplication "empty output ≠
    clean" branches and the generic try/catch path.
  - Report elision (`EVIDENCE_SAMPLE = 5`) states how many items were
    omitted rather than silently truncating — checked against the
    12-evidence-item unit test.
- **Verification re-run live** (not trusted from the commit message):
  - `npx vitest run test/boyScoutScan.test.js` → **18/18**.
  - `npx vitest run --config vitest.properties.config.mjs test/boyScoutScan.property.test.js`
    → **2/2**.
  - `node specs/pipeline/cli.js specs/features/BL-1014-the-boy-scout-scan-ranks-debt-by-what-it-keeps-costing.feature`
    → **10/10** (all 5 Scenario Outline examples plus 5 standalone scenarios).
  - Live CLI run against this real repository, twice: identical output,
    `git status` unchanged (see invariant checks above).
  - `npm run compile` (tsc -p ./) → clean, no errors.

## Property-testing pass (BL-654 scope: undeclared properties on touched pure modules)

All three pure modules' interesting properties are already the direct
subject of the three DECLARED invariants above (determinism in `rank.ts`,
evidence-bearing across `parsers.ts`, read-only across `readers.ts`/`scan.ts`).
No further round-trip/idempotence/ordering candidate found beyond what the
declared invariants already assert; nothing to add. (`normalizeSubject` IS
checked for idempotence, but as a unit-test example — `f(f(x)) == f(x)` for
one already-relative path — rather than a generated property; given it's a
single regex-based normalization with total test coverage of its only
branch, a property here would not add reach beyond the existing example.)

## What was NOT completed within this pass's practical time budget

- The repo-wide full unit suite (`npx vitest run`, no filter) and full
  property suite (`vitest run --config vitest.properties.config.mjs`, no
  filter) were both launched live via the sanctioned `detach_job.sh` (BL-995)
  to cross-check for any regression outside BL-1014's own files. System
  load spiked to 130–173 during this review (the same severe-load
  condition already tracked elsewhere as a circuit-breaker signal, not
  something this pass caused or can fix) and starved both runs badly
  enough that neither reached its final summary line within a practical
  review time budget. Not treated as a gap for THIS ticket: every
  assertion that actually concerns BL-1014's changed files was
  independently confirmed live and standalone above (unit, property,
  acceptance, compile, dependency-gate, co-change, and two hand-verified
  live CLI runs against the real repository). Both detached runs remain
  live in the background (registered, not orphaned) and their full logs
  are at `tmp/vitest_full.log` and `tmp/vitest_properties_full.log` in this
  worktree for whoever wants to read the eventual full result.
- Two PRE-EXISTING unit-lane failures surfaced in the partial run before it
  stalled — `tempDirTrapGuard` (flags `swarmforge/scripts/test/bl1025_expedite_approval_property_runner.bb`
  for a temp root with no shutdown hook) and `tmuxReaperGuard` (flags
  `specs/pipeline/steps/bl1018SingleRoleRepairNeverKillsServerSteps.js` for
  a tmux server start with no `fixtureReaper` tracking). Confirmed both
  predate this parcel (present in the prior architect HEAD `1cd6765fd`,
  before BL-1014's merge) and are unrelated to BL-1014's changed files —
  same two already flagged as pre-existing during the BL-1010/BL-1011
  architect passes earlier this session. Not re-litigated here.

— By architect.
