# BL-485 QA bounce evidence — 2026-07-17

1. **Failing command** (exactly as run, from repo root):
   ```
   grep -n "Mutation-Site Size" swarmforge/roles/cleaner.prompt
   ```
   and
   ```
   grep -rn "mutation-site-count\|mutationSiteCount\|mutation:count" swarmforge/roles/cleaner.prompt extension/package.json
   ```

2. **Commit hash checked out and tested**: `f410e68845` (documenter tip, merged into
   QA at `3d6f933e70`).

3. **First error excerpt** (both greps: no match, exit 1 — no output):
   ```
   (no output; exit status 1)
   ```

4. **Failure class**: `behavior`.

5. **Expected vs observed**: Expected — per the ticket's own scope item 2 and its
   `acceptance.outcome` ("cleaner.prompt (human-approved wording) owns a
   mutation-site size gate that splits over-threshold changed files
   behavior-preservingly before handoff") — `swarmforge/roles/cleaner.prompt` gains
   a "## Mutation-Site Size" section that runs the new count-only helper on
   changed/new files before handoff. Observed — `cleaner.prompt` has no such
   section and no reference to `mutation-site-count`/`mutationSiteCount` anywhere;
   there is also no `npm run mutation:count`-style script wiring it into any
   invocable path (`extension/package.json` has no such script). The helper itself
   (`extension/src/tools/mutation-site-count.ts`, `extension/src/quality/
   mutationSiteCount.ts`) is correctly implemented, unit- and CLI-tested, and
   verified working by hand (`node extension/out/tools/mutation-site-count.js
   extension/src/concierge/conciergeTick.ts` correctly reports 368 sites, `over`
   threshold, in 0.29s — no test-per-mutant loop run) — but it has ZERO callers
   in the live pipeline: no role prompt invokes it, no script wires it. Per
   QA.prompt's Verification Order (BL-149 precedent): "a unit that is correct and
   green on its own but invoked by nothing has zero effect in the live swarm and
   does not satisfy its intent." `docs/upstream-deviations.md`'s own BL-479 ADOPT
   entry acknowledges this gap explicitly ("cleaner.prompt's '## Mutation-Site
   Size' governance wording is a separate human-reviewed step, tracked on BL-485
   itself") — i.e. BL-485's own documentation defers BL-485's own scope item 2 to
   itself, which is circular; nothing was drafted or routed for the human review
   the ticket's `approval_context` calls for.

Note: BL-476, BL-439, and BL-487 — the three other tickets forwarded under this
same commit — all independently verify (green unit suite, green property tests,
green acceptance runs for BL-439/BL-487's feature files, and BL-476's
recert assertion is present and passing) and are approved separately; this
bounce is scoped to BL-485 only.
