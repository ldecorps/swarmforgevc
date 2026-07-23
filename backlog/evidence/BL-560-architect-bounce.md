# BL-560 — architect bounce evidence

Reviewed commit: `30de3b6f33` (cleaner) / ticket work in `003061644` (coder).
Verdict: **SEND BACK to coder.** The implementation is good and its acceptance
passes; it is held for one verified defect plus a carrier-commit entanglement.

## What is correct (keep this work — it is solid)

- **Acceptance passes, verified independently.** I ran
  `node specs/pipeline/cli.js specs/features/BL-560-github-scheduled-auto-intake-scan.feature`
  in a detached worktree at `30de3b6f33`: **5/5 scenarios pass, exit 0**. The
  coder's claim is accurate.
- **No `${{ }}` inside any `run:` body** (pin 3 / BL-227 posture) — verified in
  both workflows; `secrets.GITHUB_TOKEN` is routed through `env:` only.
- **Permissions correctly minimal**: `contents: write`, `issues: write`,
  `GITHUB_TOKEN` only, no new PAT (pin 4).
- **The shared-writer extraction is exactly right** (pin 2): `github_intake_write.sh`
  is a faithful, verbatim extraction of `swarm-intake.yml`'s own write step, and
  both paths now call it — one YAML shape, never two. The label-triggered path is
  otherwise untouched (pin 1), and scenario 5 proves it still works.
- **Dedup by issue number** via `backlog/GH-<n>-*.yaml` glob, not slug (pin 5),
  with the `swarm-intake` label as the next-run guard (pin 6). Correct.
- **The `\x1f` + base64 line framing is genuinely well-reasoned** — base64 keeps
  multi-line titles/bodies from corrupting the read loop, and the comment
  correctly explains why a tab delimiter loses an empty field (bash treats tab as
  IFS whitespace). Good catch by the coder.
- **`git pull --rebase --autostash` does NOT drop the staged intake file.** I
  suspected it might (leaving `git diff --cached --quiet` true and silently
  skipping the commit), so I tested it against a real bare origin with a genuine
  racing upstream commit: the file is still staged after `Applied autostash`, and
  the commit proceeds. **Not a defect** — recording it so nobody re-raises it.

## Defect (blocking) — arbitrary issue body corrupts the generated YAML

`github_intake_write.sh` writes the body as a bare block scalar:

```sh
echo "description: |"
printf '%s\n' "$BODY" | sed 's/^/  /'
```

A block scalar with no explicit indentation indicator takes its indent from the
**first non-empty line**. A GitHub issue body whose first line is indented — an
indented code block, extremely common — therefore sets the block indent to 6,
and every following normal line (indent 2) falls *outside* the scalar and is
parsed as a sibling key. Verified end to end:

Body `"    indented code block\nback to normal text"` produces

```yaml
description: |
      indented code block
  back to normal text
```

which fails to parse:

```
yaml.parser.ParserError: while parsing a block mapping
  expected <block end>, but found '<scalar>'  (line 6, column 3)
```

This is the constitution guardrail "Strip/escape external text embedded in
structured files (YAML comments, etc.)".

**Verified fix — one character.** Give the scalar an explicit indentation
indicator, `description: |2`. Re-parsed with that single change:

```
PARSED OK
description = '    indented code block\nback to normal text\n'
```

Content preserved byte for byte, and the `sed` already guarantees every line
carries at least the 2 spaces the indicator declares. Fixing it in the shared
writer fixes **both** intake paths at once — which is precisely the payoff of the
extraction this ticket just did.

### Why this is in scope even though the shape is pre-existing

The writer is a verbatim extraction, so the weakness predates BL-560, and the
pins correctly told the coder not to invent a second shape. But "don't invent a
second shape" is not "don't fix the one shape". BL-560 changes the risk profile
decisively: before, intake required a human to apply a label (attended, one issue
at a time); after, an unattended `*/30 * * * *` cron auto-writes, **commits and
pushes to `main`** from text any GitHub user can author. A malformed
`backlog/GH-*.yaml` landing on `main` unattended breaks backlog parsing for the
whole swarm. The acceptance passes only because no scenario feeds an
indented-first-line body — worth adding one alongside the fix.

## Carrier-commit entanglement (why this cannot simply be forwarded)

`30de3b6f33` carries **both** BL-560 and BL-530. I bounced BL-530 in the same
review round (see `BL-530-architect-bounce.md`: the launch-contract check runs
*after* `respawn-role!` has already started agents, so it never refuses the start
the ticket asks it to refuse).

Forwarding BL-560 on this commit would carry the un-approved BL-530 changes
downstream toward QA under BL-560's name — exactly the hazard in "An Approval
Authorizes Only Its Ticket's Work" (BL-506). So BL-560 is held and returned with
BL-530 rather than split.

**Re-send instruction:** fix the `|2` writer defect and BL-530's ordering, then
forward both tickets again as two separate `git_handoff`s (Article 2.6 — which
the cleaner got right this round, and which is why both tickets were reviewable
at all).

## Property testing

Not applicable to this parcel. BL-560's production surface is bash scripts and a
workflow YAML; the project's property framework is fast-check over JS
`*.property.test.js`. The slug function is property-shaped (charset invariant,
idempotence) but lives in bash, out of that framework's reach. No property test
is warranted here rather than a vacuous one.

## Gates run

- Dependency-rule gate: **PASSED** full-repo, no forbidden edges.
- Co-change: nothing at or above threshold for the changed files.

By architect.
