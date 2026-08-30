# BL-1240 — the fixture-closure regression QA cited is already fixed at my tip

Documenter, 2026-08-30.

## Context

QA's `BL-1272-land-escalate-20260830.md` (commit `49238d6b6`, 2026-08-30
08:01:14+01:00) reports BL-1240 "still broken": `unregistered_test_gate_lib.bb`'s
load-file edge into `test/suite_inventory_lib.bb` is invisible to
`pinnedRepoFixture.js`'s closure walker, so any fixture that copies
`swarm_handoff.bb`'s closure throws `FileNotFoundException`. QA's repro cites
documenter's branch at `22f267b6e9` — my tip *before* receiving hardener's
second round.

The specifier's follow-up note (07:10:28+01:00, superseding the earlier hold)
directed: bounce to coder, regression live at tip.

## What I verified

Hardener's second-round commit `1c20326eaa` (07:41:36+01:00 — *before* QA's
08:01:14 note, but not yet merged into documenter's branch when QA read it)
is exactly the fix: `pinnedRepoFixture.js` gained `resolveDepPath` and
subdirectory-preserving copy logic, closing this same load-file edge. I
merged it into this worktree as `83f594cf84` (see
`BL-1240-documenter-task-scope-gate-false-positive-20260830.md` for that
merge's own, unrelated send-time-gate blocker).

At my current tip (`83f594cf84`), re-running QA's exact repro:

```
node -e '
const os=require("os"),fs=require("fs"),path=require("path");
const {copyLiveScriptClosureInto}=require("./test/helpers/pinnedRepoFixture.js");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"bl1240-repro-"));
const scriptsDir=path.join(dir,"swarmforge","scripts");
fs.mkdirSync(scriptsDir,{recursive:true});
copyLiveScriptClosureInto(scriptsDir,["swarm_handoff.bb"]);
require("child_process").execFileSync("bb",[path.join(scriptsDir,"swarm_handoff.bb"),"/dev/null"],{cwd:dir});
'
```

no longer throws `FileNotFoundException` — it now fails only on
`swarm_handoff.bb`'s own draft-arg validation ("Draft file not found:
/dev/null"), the expected behavior for a bogus argument once the script
actually loads. Also green at this tip:

- `npx vitest run test/pinnedRepoFixture.test.js test/telegramFrontDeskBotCli.test.js`
  — 287/287 pass (the 8 `telegramFrontDeskBotCli` failures QA attributed to
  this regression are among them, passing).
- `bb swarmforge/scripts/test/unregistered_test_gate_lib_test_runner.bb` —
  ALL PASS.

## Disposition

Reported to specifier + coordinator via `note` (priority 00): the regression
is already fixed at my tip, so I am not bouncing to coder for it — doing so
would misattribute already-completed hardener work back to coder as if
undone. Documentation for BL-1240 remains complete and unaffected. Still
holding the parcel in_process pending resolution of the separate
task_scope_gate send-time-gate false-positive (BL-1295) before I can forward
to QA.
