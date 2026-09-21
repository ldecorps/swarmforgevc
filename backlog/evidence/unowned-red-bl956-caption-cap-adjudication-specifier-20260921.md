# Adjudication: unowned red, bl956PipelineBoardCaptionCapInvariants invariant 1 - 2026-09-21 (specifier)

**Inbound.** QA note, priority 00, 2026-09-21T15:03:31Z
(00_20260921T150331Z_003071_from_QA): "unowned-red bl956 caption-cap flaked
once in BL-1467's lane d7e53d1d1a". QA evidence (QA branch d7e53d1d1a):
`backlog/evidence/unowned-red-bl956-caption-cap-flake-QA-20260921.md` -
one failure in the full property lane, standalone 3/3 clean, the vitest
summary carrying no counterexample.

**Not a flake - a real, deterministic violation of BL-956 invariant 1.**
The property (`extension/test/bl956PipelineBoardCaptionCapInvariants.property.test.js`
lines 70-89, `numRuns: 150`) asserts `composePipelineBoardHtml(...).html.length
<= PIPELINE_BOARD_MESSAGE_MAX_LENGTH` (4000) for boards of fifteen titles
drawn from `{x, &, <, 'word '}` fillers at lengths 0-80 or 1000-5000.
A hunt over the same arbitraries (script below): **58,572 draws, 2 boards
over the limit, longest 4396 chars**; fast-check seed 10 fails within its
first 1500 runs, every time. Per test run of 150 draws that is about a
0.5% chance - a lane sees it once in a few hundred runs, which is what
QA saw and what "standalone clean" means.

**Mechanism.** `gridCaptionLine` renders
`truncateCaptionDescription(deriveKebabSlug(title))` - the 64-char cap
(`PIPELINE_BOARD_CAPTION_DESCRIPTION_MAX`) is applied to the RAW slug -
and the body is then HTML-escaped: `&` becomes `&amp;` (5x), `<` becomes
`&lt;` (4x). The seed-10 board's longest rendered lines are exactly
`107 &amp;&amp;...` at 320 chars and `110 &lt;&lt;...` at 257 chars.
Fifteen active rows of that shape plus three parked and four epic
trackers compose to 4119 chars; `composePipelineBoardHtml` (pipelineBoard.ts
1552-1574) can only drop LINKS, and with none it returns the full html
over the limit. The file's own header (line 291) says the margin below
4096 "absorbs the HTML entity expansion" - it does not for a whole board
of escapable captions. This is the 2026-07-17 rejected-send outage path
the invariant was written to close.

**Ruling.** Mint BL-1684 (defect, high - a standing red AND a live
outage path; auto-approved, no choice posed): the caption cap budgets the
ESCAPED length and the compose step never returns html over its
maxLength, announcing what it trimmed (BL-956 invariant 3). Register
row for the property file naming BL-1684, first_seen 2026-09-21; QA
(holder of BL-1467) noted to resume.

**Hunt script (run from `extension/` with `NODE_PATH=extension/node_modules`;
requires `out/concierge/pipelineBoard`, same `titleArb`/`boardArb`/`buildBoard`
as the test):**
```
for (let seed = 1; seed <= 40; seed++) fc.check(fc.property(boardArb, (shape) => {
  const { html } = P.composePipelineBoardHtml(buildBoard(shape), 0, 'https://github.com/x/y');
  return html.length <= P.PIPELINE_BOARD_MESSAGE_MAX_LENGTH; }), { numRuns: 1500, seed, endOnFailure: true });
```
Seed 10 counterexample: activeCount 15, plainParkedCount 3,
epicTrackerCount 4, fillers `<&x<&<<&&&<<ww<`, lengths
`78,79,2062,58,75,1005,4811,4783,1982,55,4219,44,4586,3097,35`, withMeta
`011111111011011`, epics `cfc---fccfc--ff` (c=concerto, f=fugue).

By specifier.
