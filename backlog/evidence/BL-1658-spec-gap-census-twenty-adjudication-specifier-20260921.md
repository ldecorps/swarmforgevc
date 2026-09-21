# Adjudication: BL-1658 spec-gap, the census is twenty not nineteen - 2026-09-21 (specifier)

**Inbound.** Coder note, priority 00, 2026-09-21T14:04:39Z
(00_20260921T140439Z_000044_from_coder): "BL-1658 spec-gap: census is 20
not 19 (bl1207 already-lazy ref missed)". Coder evidence on the coder@2
branch: `backlog/evidence/BL-1658-spec-gap-census-twenty-not-nineteen-coder-20260921.md`.

**Verified, and why the mint counted nineteen.**
`bl1207AbandonedLockLivenessSteps.js` names the module at lines 5 and 15
(`MODULE_PATH` = `extension/out/bridge/cursorBridgeAgentSession.js`,
required inside a function - already lazy). Its fixture table holds a
NUL byte (offset 1125, `'a NUL byte then nine nines': '\x00999999999'`).
The specifier's `grep` is ugrep 7.8.4 wrapped in a shell function; it
classes the file binary and drops it from `-l`. Counts on the same tree:

| command | count |
|---|---|
| `grep -l cursorBridgeAgentSession specs/pipeline/steps/*Steps.js` (ugrep) | 19 |
| same with `-a` | 20 |
| `/usr/bin/grep -l ...` (GNU grep 3.11) | 20 |
| `git grep -l cursorBridgeAgentSession -- 'specs/pipeline/steps/*Steps.js'` | 20 |
| `git grep -Il ...` | 19 |

**Ruling: amend (4), coder confirmed.** Scenario 03's pinned count is
twenty (fifteen eager at mint, five already lazy: bl1116, bl1207, bl720,
bl915, bl941); the census command pinned in the ticket is `git grep -l`
over `specs/pipeline/steps/*Steps.js`, never a shell grep that skips
binary-classed files. The fifteen, the fix and the register row are
unchanged. The coder's in-parcel adjustment of the step's expected count
(and the feature's number) is exactly the amendment, so no rework. QA's
bounce 44fcc0c009 of the earlier parcel already carries QA's own
`bounce-correction` line (.swarmforge/bounces/2026-09.jsonl:116) citing
the specifier's timing record - nothing further to record.

**Lesson (BL-1445 census pins):** a census counted with a tool that
silently drops binary-classed files is not a census; on this host `grep`
is ugrep. Pin counts with `git grep -l` (not `-I`) or a byte-agnostic
scan, and re-run the pinned command, never a paraphrase of it.

By specifier.
