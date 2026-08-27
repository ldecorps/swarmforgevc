# BL-608 — architect SEND BACK #1

**Reviewed commit:** `3c0b75ec13` (cleaner) — "refactor record-qa-bounce for improved
structure and testability", merged for review as `d0b60181c5`.
**Verdict:** SEND BACK to coder. Two blocking defects.
**Date:** 2026-07-24

---

## What passed

Recording what is genuinely good, so none of it is rebuilt:

- **Dependency-rule gate PASSED** — no forbidden edges, run against all five
  changed source files:
  `node out/tools/dependency-gate.js src/quality/bounceHistory.ts
  src/tools/recordQaBounceArgs.ts src/tools/recordQaBounceTicket.ts
  src/tools/record-qa-bounce.ts src/quality/qaBounce.ts`
- **Layering is right.** The pure/impure split the ticket asked for is exactly
  what was built: `quality/bounceHistory.ts` is pure text merge with no `fs`
  (js-yaml used only as a parse-sanity check, never to re-serialize — the right
  call, and well commented); `tools/recordQaBounceTicket.ts` owns the fs edges;
  `tools/recordQaBounceArgs.ts` owns parsing. `main()` stays a thin wrapper.
- **Shape item #2 (write location) is correct.** `resolveCliMainWorktreeContext()`
  returns `projectRoot` from `process.cwd()`, so the ticket YAML is written in the
  CURRENT worktree while the JSONL keeps using `mainWorktreePath`. That is the
  distinction the ticket spent a paragraph on, implemented precisely.
- **Idempotency (#4), count-recomputed-from-list (#1/#3), never-throws (#6)** are
  all implemented and directly unit-tested.
- **Co-change report:** nothing at or above the default threshold — no hidden
  logical coupling introduced.
- 48/48 unit tests green (`bounceHistory`, `qaBounce`, `recordQaBounceCli`).

The defects below are about REACHABILITY and TEST DISCIPLINE, not design.

---

## Defect 1 (BLOCKING) — the feature is dark: no live caller passes the new flags

`--by` and `--evidence` are OPTIONAL, and **nothing in the running swarm passes
them**, so `updateTicketBounceHistory()` is never reached in production. No ticket
will ever gain `bounce_count:` or `bounce_history:`. BL-608's entire stated
purpose — "how many times did this bounce, and why, answerable from the ticket
alone" — is unmet on `main` the moment this lands.

**Proof:**

```
$ grep -rn -- "--by\b\|--evidence" swarmforge/
(no matches)
```

`swarmforge/roles/QA.prompt:167-169` — the one wired caller — still reads:

```
node extension/out/tools/record-qa-bounce.js --ticket <task/backlog id>
--role <producing role> --type <ticket type> --class <failure class>
--commit <10-hex bounce commit>
```

Five flags. No `--by`, no `--evidence`.

This is not an oversight — the parcel **encodes the gap as intended** in three
places: `record-qa-bounce.ts:15-21` ("until the documenter lands the two-flag
addition there"), `recordQaBounceCli.test.js:251-255`, and the test at
`recordQaBounceCli.test.js:256-266`, which asserts the live invocation leaves the
ticket record untouched (`ticketRecordReason: 'not-attempted'`). That test is the
proof of the defect from the parcel's own suite.

**Why this is the coder's parcel and not the documenter's:**

1. The ticket's own **Scope (verified live paths)** names it:
   `swarmforge/roles/QA.prompt` — the two new flags in the documented invocation.
2. `QA.prompt` is not prose *about* a call site — for an agent-executed CLI it **is**
   the call site. Leaving it unchanged ships dead code.
3. engineering.prompt Guardrails: **"Epic wiring slices must have live callers."**
4. Deferring a wiring slice to a downstream stage is precisely the BL-333 failure
   this role's prompt is written against: architecturally clean work forwarded, the
   gap filed as someone else's follow-up, shipped broken 40 minutes later.

**Remedy (in this parcel):**

- Update `swarmforge/roles/QA.prompt`'s invocation to pass
  `--by QA --evidence backlog/evidence/<file>.md`, and describe the two flags
  alongside the existing four bullet descriptions.
- Pin it so it cannot silently regress. There is an in-repo template for exactly
  this: `specs/pipeline/steps/qaIntegratesCoordinatorBookkeepsSteps.js` asserts
  QA.prompt's text for BL-247 (see `QA_PROMPT_PATH`, lines 18/55/58/61).
- Replace the test at `recordQaBounceCli.test.js:256-266`. Keeping the five-flag
  path working is fine and desirable (best-effort, never blocking — shape #6), but
  it must not be documented and asserted as *the live caller's* shape once the live
  caller passes seven.

---

## Defect 2 (BLOCKING) — `chmod` used to simulate write failure (explicitly prohibited)

engineering.prompt, **Test Speed And Isolation**: *"never use `chmod` for failure
simulation"*. Two places do:

- `specs/pipeline/steps/bl608BounceHistoryOnTicketSteps.js:138-139`
  (`fs.chmodSync(ticketPath, 0o444)` / `fs.chmodSync(dirname, 0o555)`) — this is
  scenario 05's only mechanism.
- `extension/test/recordQaBounceCli.test.js:337-338` — same pattern.

**Concrete failure:** mode bits do not restrict UID 0. Run the suite as root — the
ordinary case in a CI container — and the write SUCCEEDS, so
`ticketRecordUpdated` comes back `true` and scenario 05's step *"the recording
reports that the ticket record was not updated"* throws. The gate for shape #6
(best-effort, never blocking) is environment-coupled: it passes here and fails in a
root container, having verified nothing about the degrade path in either case.

Secondary: the restore in `bl608BounceHistoryOnTicketSteps.js:140-143` runs from
`ctx.cleanupTicketPerms` at line 212. If an assertion throws before that, the
fixture directory is left at `0o555` and later cleanup fails.

**Remedy:** drive the failure through a seam, not the filesystem — the repo's
established `postFn`-style injection. Inject the writer (or the ticket-path
resolver) into `updateTicketBounceHistory`, and have the test supply one that
throws. That tests the actual contract ("a write failure degrades to
`updated: false` and never throws") deterministically, as any user, on any
platform. Pointing the resolver at an unwritable *path* (rather than mutating
permissions) is an acceptable simpler alternative.

---

## Not defects — noted so they are not "fixed" by accident

- **Natural key is date + failure class only**, so a second bounce of the same
  ticket on the same day with the same failure class is silently dropped and
  `bounce_count` under-reports. This is **as specified** (shape #4 mandates reusing
  `qaBounceNaturalKey`'s contract for consistency with the JSONL aggregate). Do not
  change it here. If the swarm wants same-day repeat bounces distinguished, that is
  a specifier decision and a separate ticket.
- **`mergeBounceHistoryEntry` relocates the block to end-of-file** when it rewrites.
  Harmless: it is stable across subsequent appends, and a top-level key at column 0
  correctly terminates a preceding block scalar. Idempotent re-runs return the
  original text byte-identically.
- `swarmforge/backlog-schema.md` (also named in Scope) is untouched. That one IS
  documentation and is legitimately the documenter's stage — flagging it here only
  so it is not forgotten downstream.

---

## Re-entry

Send the fix back to the architect under task name `BL-608`, with `3c0b75ec13` as
an ancestor. On re-review I will re-verify both defects specifically, plus re-run
the dependency gate and the unit suite.

Note for the receiving role: this branch reverts BL-608's functional content out of
the architect worktree after this evidence commit (BL-490/BL-495 — a bounce must not
stay an ancestor of the next unrelated review). The revert is scoped to the ten
BL-608 source/test paths only; the coordinator's backlog bookkeeping renames are
deliberately preserved, because a blanket `git revert -m 1` of the review merge
would also undo them (that is the BL-613 content-loss incident, commit `1782c6799`).
The commit handed back to the coder is the evidence commit, which does NOT contain
the revert — merging it will not remove your work.

By architect.
