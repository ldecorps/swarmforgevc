# BL-1511 — coder spec-gap finding, 2026-09-16

## The ticket's premise for dropping PACK_STAFFING_SKIP_GATE is unverified

The ticket states: "measured 2026-09-10 by the specifier,
`pack_staffing_gate_cli.bb` reads `pass` on every b.ai line... so the
hatch is not required" and instructs (FIRM) that the LAUNCH/PREREQ lines
naming `PACK_STAFFING_SKIP_GATE=1` be dropped.

## The qa_e2e_procedure's own literal command is a no-op

`pack_staffing_gate_cli.bb`'s own usage comment: `<repo-root>
<windows-file>`, where `windows-file` lines are
`seat-id<TAB>stage<TAB>agent<TAB>extra-cli` (tab-separated). The ticket's
qa_e2e_procedure step 1 passes the RAW PACK FILE
(`swarmforge/packs/bob-multi-provider-mono-router.conf`) as that
argument. The pack file contains **zero tab characters**
(`grep -cP "\t"` → 0). The CLI's line parser (`str/split line #"\t" 4`)
therefore returns a one-element vector for every line - `stage`/`agent`/
`extra-cli` all resolve `nil` - and every line, including comments and
`config` lines, reads back `pass`. Verified: running this exact command
prints `pass` for `# bob-multi-provider-mono-router — BoB mono-router
starting cast.` and for `config active_backlog_max_depth 1`, neither of
which is a window line at all. **This command verifies nothing about
staffing** - it cannot distinguish a staffed pass from a malformed input.

## The REAL gate (correct invocation) currently refuses both coder and the new specifier line

Built a correctly-shaped windows-file by hand and ran the same CLI
directly:

```
$ printf 'coder\tcoder\taider\t--model openai/glm-5.3-flash ...' | ...
coder	refuse	tencentcloud2	glm-5.3-flash	not-on-role-matrix	...

$ printf 'specifier\tspecifier\tclaude\t--model claude-fable-5-1 ...' | ...
specifier	refuse	anthropic	claude-fable-5-1	not-on-role-matrix	...
```

Confirmed independently via the REAL launcher: sourcing `swarmforge.sh`
against a scratch root with `SWARMFORGE_CONFIG` pointed at the real pack
file, `PACK_STAFFING_SKIP_GATE` explicitly unset, and running the real
`parse_config` - it refuses on the `coder` window line (line 91) with the
identical `not-on-role-matrix` verdict, before ever reaching the new
specifier line.

`bb swarmforge/scripts/model_steward_cli.bb role-matrix coder` /
`role-matrix specifier` in this worktree list only
`anthropic/claude-sonnet-5` (and `openai/gpt-5.3-codex` for coder) -
neither `tencentcloud2/glm-5.3-flash` nor `anthropic/claude-fable-5-1`
appear. This worktree's `.swarmforge/model-steward/` has no `trials/`
directory and no `registry.json` entry for either model - it does not
carry the evidence the operator's intake and this ticket's own
`ruling_provenance: tapped` cite (e.g.
`.swarmforge/model-steward/trials/glm-bai-specifier-lite-20260909/`).
`.swarmforge/` is gitignored, per-worktree runtime state (BL-1428's own
header note makes the same point about the standing-red allowlist) - I
cannot tell from here whether this worktree's copy is simply stale
relative to wherever the operator/specifier's own scoring evidence lives,
or whether that evidence has itself decayed since 2026-09-10.

## What I did NOT do

I did not remove `PACK_STAFFING_SKIP_GATE=1` from PREREQ/LAUNCH. Doing so
on an unverified (and, by my own correct-invocation test, currently
contradicted) premise risks a REAL swarm launch hard-refusing on the
`coder` window line - the pack's own resident/home role - the moment
someone follows the new LAUNCH line. I completed the rest of the ticket
(the specifier window line on `claude`/`claude-fable-5-1`, the header
role-table row, removing the "deliberately ABSENT"/"nothing can rotate"
prose) since those do not depend on this premise and are correct
regardless of its outcome.

## Ask

Please adjudicate: (a) re-verify staffing with a correctly-shaped
windows-file (or from whichever worktree/session carries the fresher
model-steward evidence) and confirm whether coder/specifier are
genuinely on the role matrix today, and (b) fix the qa_e2e_procedure's
own CLI invocation regardless (it verifies nothing as written, independent
of the freshness question). I will complete the launch/prereq line change
once this is confirmed either way.
