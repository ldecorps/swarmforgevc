# BL-911-rotation-recomposes-the-role-prompt — architect re-pass (post-QA-bounce)

Re-reviewed after QA bounced D1 (missing `prompt_engine_lib.bb` entry in the
BL-814 fixture's `REQUIRED_SCRIPT_FILES`, evidence:
`backlog/evidence/BL-911-rotation-recomposes-the-role-prompt-bounce-20260817.md`).

## Scope of this pass

`git diff --stat c51bea615..HEAD -- . ':!backlog/evidence' ':!backlog/topics'`
(c51bea615 = my prior clean architect pass, before QA's bounce) shows exactly
one file changed since then:

```
extension/test/readLiveRoleHeldTicketsCli.test.js | 8 ++++----
```

Everything else this parcel touches (Specification.MD, handoff-protocol.md,
the two `.feature` files) was already reviewed and approved in the prior
pass and is unchanged since. This pass covers only the coder's fix commit
`0a372f6e6`.

## Fix verified correct

- QA's remediation pointer: add `'prompt_engine_lib.bb'` to
  `REQUIRED_SCRIPT_FILES` in `extension/test/readLiveRoleHeldTicketsCli.test.js:25`.
- Coder's commit does exactly that, and nothing else.
- Independently confirmed the dependency is real: `swarmforge/scripts/handoff_lib.bb:36`
  has `(load-file ... "prompt_engine_lib.bb")`, and `swarmforge/scripts/prompt_engine_lib.bb`
  exists. The fixture's copy list now matches.
- This is a test-fixture data change only — no production module, no
  architecture boundary, no declared invariant touched by this diff.

## Dependency-gate hard check (BL-259)

Ran `node extension/out/tools/dependency-gate.js test/readLiveRoleHeldTicketsCli.test.js`
and also the full-repo scan (no args) for comparison — both report the same
3 `acyclic` violations:

```
telegram-front-desk-bot.ts -> telegramCursorOperatorExec.ts
telegram-front-desk-bot.ts -> telegramCursorOperatorLiveness.ts
telegramCursorOperatorExec.ts -> telegramCursorOperatorLiveness.ts
```

Traced the edges: `telegram-front-desk-bot.ts` lazy-`import()`s both
Operator files at runtime (lines 2167, 2172); both of those statically
import `isPipelineEmpty`/`controlDrainTimeoutMs` back from
`telegram-front-desk-bot.ts`. dependency-cruiser's static graph analysis
sees the lazy `import()` as an edge too, so it reports the cycle regardless
of the runtime workaround. Confirmed via `git log` this predates BL-911 by
a wide margin (edges present since the BL-700–704 Cursor Remote operator
slices, well before this ticket existed) and no file BL-911 touches is
part of the cycle. Also confirmed the test file is excluded from
depcruise's own scan (`exclude: '\.test\.js$'` in
`.dependency-cruiser.cjs`), which is why the scoped-to-one-file invocation
and the full-repo invocation produced identical output — the tool falls
back to full scope when its only positional arg is excluded.

**Not attributed to this parcel, not bounced for it** — per BL-506 (an
approval authorizes only its ticket's work) and BL-911's own explicit
Out-of-scope section. No ticket currently tracks this cycle
(`grep -rl telegramCursorOperator backlog/` → none); flagging it via a
separate `note` to specifier+coordinator so it gets ticketed, rather than
folding it into this parcel or silently dropping it.

## Co-change (informational, BL-255)

Ran against the changed file — reports the expected coupling with the
ambulance/handoff-lib scripts and the BL-814/BL-487 sibling test files this
fixture has always tracked. Nothing new or suspicious introduced by this
one-line fix.

## Invariants / property coverage

Unchanged from the prior pass — this diff touches no invariant-bearing
code. Both declared invariants were already verified with live coverage in
the prior architect pass (`c51bea615`).

## Verdict

Architecturally COMPLIANT. Forwarding to hardender.

By architect.
