# BL-1290 — architect pass, 2026-09-05

Ticket: BL-1290-a-socket-fixture-is-rooted-short-enough-to-bind
Role: architect
Commit reviewed: 90d463f4da (coder — routed directly per `stage_skip_reasons`
in the ticket YAML: cleaner/hardener/documenter all skipped with recorded
justification, `required_stages: [coder, architect, qa]`)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate** (`extension/out/tools/dependency-gate.js`), both
  scoped to all three touched/new step files and full-repo:
  `Dependency-rule gate PASSED: no forbidden edges.` in both. Change is
  test-fixture-only (two step files swapping their root helper) plus one
  new step handler using the existing shared `lib/socketFixtureRoot.js` —
  no webview, no VS Code API, no secrets, no browser storage.
- **Co-change report**: only each file's own pre-existing feature-family
  coupling — nothing new or suspicious.

## Sole invariant, verified against the real length limit (not a Linux pass)

"No control-socket fixture path can exceed swarm_socket_lib.bb's length
limit on any supported OS." The ticket's own `approval_context` warns this
defect is invisible on Linux (where the swarm runs) and only bites on
macOS's long temp base — so I verified this the same way the ticket
insists: by reading `lib/socketFixtureRoot.js` and confirming
`mkSocketFixtureRoot` roots under the FIXED, OS-independent `/tmp` (never
`os.tmpdir()`, which resolves to the long `/var/folders/.../T/` on macOS
specifically) and self-asserts headroom against
`WORST_CASE_SOCKET_SUFFIX`/`SOCKET_PATH_GUARD_LIMIT` at creation time,
throwing loudly if a prefix would overrun it — this makes the guarantee
structural (true on any OS `/tmp` is short on), not incidental to the host
this review runs on.

## Per-file review

- **`bl1112StandingUnitRedsSteps.js`** and **`bl691AmbulanceWorkflowGapsSteps.js`**:
  both swapped `fs.mkdtempSync(path.join(os.tmpdir(), '<prefix>-'))` for
  `mkSocketFixtureRoot('<prefix>-')`, removing the now-unused `os` import
  in both files. Minimal, exactly the adoption the ticket directs — no new
  machinery, no behavior change beyond the fixture root.
- **`backlog/standing-reds.tsv`**: the coder correctly removed its own row
  in the same commit that turned the test green, per BL-1428's own
  convention ("a land turning a test green removes its row in the same
  commit") — verified this is exactly what changed (one row removed, no
  other row touched).

Ran the standing red directly: `npx vitest run
test/socketFixtureShortRootGuard.test.js` → 16/16 pass (was the standing
red; now green). Also ran the sibling guard `liveRepoDerivationGuard.test.js`
(BL-1291, adjacent work today) alongside it for regression: 35/35 combined,
no interaction issue between the two fixture-convention fixes.

## Acceptance wiring

Feature declares 3 scenarios / 4 scenario runs (Outline with 2 examples +
2 plain scenarios). Independently drove
`bl1290SocketFixtureShortRootSteps.js::registerSteps` against all 4 with
my own harness — all passed, including scenario 03's real length
measurement against `mkSocketFixtureRoot`'s actual converted prefixes (not
a synthetic stand-in, and not merely "passes on this Linux host").
`registerSteps` export present per the ticket's `required_wiring` anchor
(BL-1371).

## On the stage-skip routing

The ticket's own `stage_skip_reasons` (cleaner: adopting the shared helper
IS the de-duplication, no further folding needed; hardender: no production
module changes, and scenario 03 already is the non-vacuity check a
hardener pass would otherwise add; documenter: no living doc describes
fixture-root convention) are consistent with what I found in the diff —
two test-fixture call sites and one step handler, no production code.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect spotted. Forwarding to QA per this
ticket's `required_stages: [coder, architect, qa]`.
