# BL-117 QA bounce — extracted Gherkin scenario text absorbs the NEXT
# scenario's leading comment tag, and the last scenario absorbs the entire
# trailing "Non-behavioral gates" comment block

## Failing command
```
cd extension && npm run compile
node out/tools/generate-docs-tree.js > /tmp/docs-tree.json
python3 -c "
import json
data = json.load(open('/tmp/docs-tree.json'))
t = {t['id']: t for t in data['tickets']}['BL-106']
print(repr(t['scenarios'][0]['text']))   # first scenario
print(repr(t['scenarios'][-1]['text']))  # last scenario
"
```
Run from the repo root (`/home/carillon/swarmforgevc`), against the real
`main` worktree's real backlog content — no fixture needed, this reproduces
on any multi-scenario ticket in the repo.

## Commit hash tested
`f6caba5e3e` (documenter's handoff, `BL-117-pwa-docs-drilldown`), merged
into QA at `7abbf2f7f4`.

## First error excerpt
First scenario of `BL-106` (real ticket, feature-file-reference form),
extracted via the real `generate-docs-tree.js`:
```
'Scenario: launcher derives branch names from swarm_name\n  Given a conf with swarm_name alpha\n  When the swarm launches its worktrees\n  Then every role worktree is on branch alpha/<role>\n\n# BL-106 branch-ns-02'
```
Note the trailing `# BL-106 branch-ns-02` — that comment tag belongs to
the SECOND scenario, not this one.

Last scenario of the same ticket:
```
'Scenario: migration preserves everything\n  Given the current mixed-scheme branches\n  When the migration runs\n  Then each role worktree is on its unified branch with identical HEAD\n  And stale duplicate role branches are removed only if fully merged\n\n# Non-behavioral gates:\n#  - Derivation/validation logic script-tested; migration rehearsed on\n#    a scratch clone before the live run.\n#  - No history rewrite; branch renames only.'
```
The entire trailing "Non-behavioral gates" comment block (4 lines of
scope/testing notes, not scenario content) is appended to the last
scenario's text.

Root cause (`extension/src/docs/gherkinScenarios.ts`,
`groupIntoScenarioBlocks`): every line that is not itself a `Scenario:`/
`Scenario Outline:` line is unconditionally appended to whichever block is
currently open — including a `# BL-XXX foo-NN` comment tag that precedes
the NEXT scenario, and the trailing `# Non-behavioral gates:` block after
the LAST scenario. Nothing stops collecting into the current block until a
new `Scenario:` line appears or the input ends, so any comment-only
content between the end of one scenario's real Given/When/Then/And lines
and the start of the next construct gets misattributed to the scenario
that precedes it.

## Failure class
`behavior`

## Expected vs observed
Expected (`BL-117 docs-drilldown-01`/`03`): "drilling into the ticket's
acceptance shows its Gherkin scenarios as readable scenario text" — for
BOTH the inline and feature-file forms.

Observed: every scenario in a multi-scenario ticket except the very first
one gets a stray, unrelated leading-comment-of-the-next-scenario line
appended to the end of its own text, and the LAST scenario in the ticket
additionally absorbs the entire trailing `# Non-behavioral gates:` comment
block. This is not cosmetic noise on an edge case — essentially every
ticket in this repo with 2+ scenarios uses the `# BL-XXX scenario-name`
comment-tag convention between scenarios (verified: BL-106, BL-122, and
every other feature file/inline block read this session follows it), so
this reproduces on the large majority of real tickets a phone user would
actually drill into, not a rare corner case.

The existing test `'ignores comment lines (# BL-NNN tag lines) between
scenarios'` (extension/test/gherkinScenarios.test.js:71) is misleadingly
named — it only exercises a comment line BEFORE the first scenario
(dropped correctly by construction, since `blocks.length` is still 0 at
that point), never a comment line BETWEEN two scenarios or after the last
one, which is the actually-broken case. No existing test in
`gherkinScenarios.test.js` or `docsTree.test.js` covers a fixture with 2+
scenarios separated by a `# BL-XXX ...` comment tag against real repo-shaped
content, which is why this passed the full suite while failing on real
data.

Suggested fix direction: stop collecting lines into a block once a
comment-only line (`/^\s*#/`) is encountered following at least one
Given/When/Then/And line, OR post-process each block to drop trailing
comment-only lines before joining — either way, a scenario's text should
end at its own last step line, never absorb the next scenario's tag or the
feature file's closing comment block. Add a test with a real multi-scenario
fixture (mirroring an actual `.feature` file's shape) asserting the FIRST
scenario's text does not contain the second scenario's tag, and the LAST
scenario's text does not contain the trailing non-behavioral-gates comment.
