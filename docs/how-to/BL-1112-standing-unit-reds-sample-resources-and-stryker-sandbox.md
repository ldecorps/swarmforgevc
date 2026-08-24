# Standing unit reds: sampleResources and Stryker sandbox siblings (BL-1112)

## The gap

QA of an unrelated parcel (2026-08-23) found seven deterministic unit
failures already on main:

| Suite | Symptom |
| --- | --- |
| `sampleResourcesCli` | Expected `SAMPLED 1 role(s)`, got `0` (agent never matched) |
| `strykerSandboxSiblingsLib` | Replacing a stale sibling symlink threw `EEXIST` |

Standing reds on `npm test` hide real regressions.

## What changed

**Resource sampler (`listProcessTree`):** `ps -A -o pid=,ppid=,args=` — match
the basename of the first argv token. Node 24+ on Linux puts thread names
such as `MainThread` in `/proc/*/comm`, so `comm=` never equalled
`DEFAULT_AGENT_COMMAND_NAME` (`claude`) and every headless sample recorded
zero roles.

**Stryker sandbox siblings:** before `symlinkSync`, `removeStaleSiblingPath`
`unlink`s the link inode (`lstat` / `unlink`). `fs.rmSync` alone can leave a
dangling symlink in place (`existsSync` follows the missing target and
reports false while the link remains), so recreate threw `EEXIST`.

## Operator note

From `extension/` with `swarm.env` loaded:

```bash
npx vitest run test/sampleResourcesCli.test.js test/strykerSandboxSiblingsLib.test.js
```

Both suites should be green. Complements BL-847 (measure the agent, not the
shell) and the Stryker sandbox sibling-link helper for mutation runs.

## FF-only rematch

QA bounced tips that re-merged into hitchhiked ancestry (ACP / hotfix-ledger /
INTAKE / done-moves vs `origin/main`). Downstream roles must **recreate** on
the clean tip (`git checkout -B … <tip>`), not `git merge` into a dirty
branch. Hitchhike gate:

```bash
git diff --name-only origin/main...HEAD \
  | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8' \
  && echo FAIL || echo CLEAN
```

Stamp-off for the Pipeline Board DC/QA spacer matches live `escapeHtml`
(`&nbsp;` on `origin/main`). Feature wording remains “HTML nbsp entity”.

Acceptance:
`specs/features/BL-1112-standing-unit-reds-sample-resources-and-stryker-sandbox.feature`
