# Raw intake — Unit suite is red again; analyze what fails and why (do not dismiss)

Status: new intake, not minted. Capture only (human via Cursor 2026-08-05
~09:30 CEST). Human is concerned that the swarm repeatedly treats a red unit
suite as non-concerning ("environmental" / load flake) and keeps shipping.

Related
- Epic `unit-suite-speed` (BL-791) / done slice A BL-792 — suite was made green
  and profiled on 2026-08-03; it is red again.
- BL-487 — board freshness / live role-held tickets (two of today's failures).
- BL-536 QA bounce evidence 2026-08-05 — full `npm test` already recorded
  7 files / 11 tests failing; dismissed as host load (load avg 254) and not
  ticketed.
- BL-761 QA bounce evidence 2026-08-04 — similar pattern (3 fails + vitest
  worker timeouts; some pass in isolation, one deterministic).
- Standing host condition: load averages have sat in the **250+** band on a
  4-core box while continuous 3-shift operation is armed
  (`.swarmforge/operator/INTAKE-continuous-shifts-until-revoked.md`). That
  may explain *some* timeouts; it does **not** license ignoring assertion
  failures or leaving the suite permanently untrusted.

## Goal

1. **Inventory** the current failing unit tests: what each one covers, which
   production seam it guards, and which ticket originally introduced it.
2. **Classify** each failure: real regression / fixture drift / genuine
   load-induced flake / suite-infra (vitest worker RPC timeouts).
3. **Spec fix tickets** for every real regression and every flake that has
   become a standing blind spot (a failure the pipeline routinely waves
   through). Do not mint a single "make green somehow" ticket that deletes
   coverage or raises timeouts without a measured cause.
4. **Surface the meta-defect**: QA/hardener/coder parcels that observe a red
   `npm test` and proceed with "unrelated / environmental, not bouncing"
   leave the safety signal broken — the same concern BL-792's approval
   context called out when every recorded run since 2026-07-07 was a fail.

## Problem

A full extension unit suite run on 2026-08-05 (log: `/tmp/vitest_full.log`,
started 07:56:55 local, duration ~432s) ended:

```
Test Files  4 failed | 397 passed (401)
     Tests  7 failed | 7081 passed (7088)
    Errors  119 errors   ([vitest-worker]: Timeout calling "onTaskUpdate")
```

Human recalled "~8 failing"; the measured count is **7 tests / 4 files**.
Treat the measured set as authoritative; if a later quiet-host re-run shows
a different set, update the inventory — do not invent an eighth.

### Measured failures (2026-08-05)

| # | File | Test | Failure mode |
|---|------|------|--------------|
| 1 | `test/dependencyGateCliReportsAndScope.test.js` | running the REAL checker twice over identical fixture code produces byte-identical reports | `Test timed out in 20000ms` |
| 2 | `test/dependencyGateCliStorageGlobals.test.js` | QA bounce repro: runGate flags a bare localStorage.setItem(...) global reference that depcruise alone misses | `Test timed out in 20000ms` |
| 3 | `test/readLiveRoleHeldTicketsCli.test.js` | BL-487: reports a role-held ticket computed LIVE from the real in_process mailbox | **Assertion**: expected `{ coder: ['BL-900'] }`, got `{}` |
| 4 | `test/readLiveRoleHeldTicketsCli.test.js` | BL-487: a stale/absent ticket-stage-map.json cache is irrelevant | **Assertion**: expected `{ coder: ['BL-900'] }`, got `{}` |
| 5 | `test/renderBriefingDiagramsCli.test.js` | renders exactly the two maintained diagrams, named and base64-encoded | `Test timed out in 20000ms` |
| 6 | `test/renderBriefingDiagramsCli.test.js` | main() runs in-process against the real repo and prints the two maintained diagrams as JSON | `Test timed out in 20000ms` |
| 7 | `test/renderBriefingDiagramsCli.test.js` | the compiled CLI runs standalone as a subprocess and produces the same result | `Test timed out in 20000ms` |

**Do not treat rows 3–4 as load flakes.** They are strict deep-equal
failures returning an empty map. The test file's own comment (BL-655) states
that a missing `load-file` dependency in the copy-real-scripts fixture makes
`readLiveRoleHeldTickets` **silently degrade to `{}`** — exactly today's
symptom. Prime suspect: another transitive `.bb` dependency landed after
`ambulance_lib.bb` was added to the fixture copy list, and the fixture was
not updated. Confirm or kill that theory with an isolated quiet-host re-run
and a live `bb … report` against the fixture.

Timeouts (rows 1–2, 5–7) may be load, may be real slowdowns past the 20s
per-test budget, or both. Classify with isolation re-runs on a quiet host
(check `uptime` first — a load-250 host makes every number meaningless).

## Why this matters

- A red unit suite with "we waved it through" notes means a real regression
  and worker-termination noise look identical — BL-792's own rationale for
  expediting greenness.
- Two of the seven failures already look like a **missed-consumer regression**
  on the live board / role-held ticket path (BL-487), which is production
  board freshness, not a flaky renderer.
- Continuous 3-shift operation without a green suite leaves every later
  parcel's hardening gate untrustworthy.

## Human decisions locked in this conversation (2026-08-05)

Specifier may challenge or refine; do not silently drop these without asking.

1. **Analyze first, then fix.** First deliverable is an inventory +
   classification committed as evidence (or in the ticket description). Fix
   tickets may follow in the same drain pass (1:N split is fine).
2. **Do not dismiss as environmental without isolation proof.** A failure
   that still fails alone on a quiet host is a defect. A failure that only
   appears under load avg ≫ core count may still need a ticket if it is a
   standing blind spot the pipeline keeps swallowing.
3. **Do not make green by deleting coverage**, skipping tests, widening
   exclude globs, or raising timeouts without a measured cause (same
   invariants as BL-792).
4. **Priority / severity posture.** Human treats an unexplained red suite as
   concerning. Default proposal: `type: defect`, `severity: high` for any
   confirmed regression (esp. the BL-487 `{}` path); severity for pure
   load-flake hardening is the specifier's call but must not vanish into
   "noted, not bouncing."
5. **Meta ask.** Specifier should also say whether a small process/gate
   change is warranted so "red npm test, proceeding anyway" stops being a
   quiet default on QA/hardener passes — or whether existing Article 4
   language already forbids it and the gap is enforcement. If process: keep
   it a separate small ticket, not stuffed into a product fix.

## Requested outcome

1. Specifier drains this intake into paused ticket(s) with prose + Gherkin
   (or a clear analysis-only first slice if the right cut is "report then
   fix").
2. Evidence names each failing test, what production behavior it covers, and
   the classified cause.
3. Real regressions get fix tickets (or slices) that restore green without
   dropping coverage.
4. Coordinator / QA get an explicit signal that a red suite is concerning
   again — not background noise.

## Out of scope for this intake alone

- Cutting the unit-suite-speed poles (BL-791 slice B) — separate, still
  blocked on a trustworthy green baseline.
- Fixing the host's sustained overload / duplicate supervisors (briefing
  2026-08-05 Flagged items) — related cause, separate tickets if needed.
- Android JVM suite, property suite, acceptance wall-clock.

## Evidence pointers

- `/tmp/vitest_full.log` (2026-08-05 ~07:56–08:04) — full failure bodies.
- `backlog/evidence/BL-536-provider-auth-error-auto-respawn-bounce-20260805.md`
  (lines on full suite 7 files / 11 tests failed, dismissed as load).
- `docs/reference/BL-792-test-duration-profile.md` — last known green profile.
- `extension/test/readLiveRoleHeldTicketsCli.test.js` — fixture copy list +
  silent-`{}` comment.
