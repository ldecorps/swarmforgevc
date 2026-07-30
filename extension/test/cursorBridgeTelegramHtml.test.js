const assert = require('node:assert/strict');
const {
  TELEGRAM_GRID_MAX_WIDTH,
  escapeTelegramHtml,
  telegramHtmlToPlainText,
  isMarkdownGridSeparatorRow,
  parseMarkdownGridRow,
  takeMarkdownGrid,
  gridWidth,
  renderGridAsMonospace,
  renderGridAsStackedHtml,
  renderMarkdownGridHtml,
  inlineMarkdownToTelegramHtml,
  markdownToTelegramHtml,
  shouldRetryTelegramPostAsPlainText,
  splitTelegramHtmlChunks,
} = require('../out/bridge/cursorBridgeTelegramHtml');

// BL-696 amendment: a markdown grid in an agent reply must reach the phone
// RENDERED. Telegram has no table markup, so a grid becomes an aligned
// monospace <pre> block (or, when it cannot fit a portrait screen, one
// labelled block per row). Pure text decisions only — no Telegram I/O.

// ── escaping ────────────────────────────────────────────────────────────

test('escapeTelegramHtml escapes only the three characters Telegram HTML reserves', () => {
  assert.equal(escapeTelegramHtml('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
  assert.equal(escapeTelegramHtml('quotes " and \' survive'), 'quotes " and \' survive');
  assert.equal(escapeTelegramHtml('<none>'), '&lt;none&gt;');
});

test('telegramHtmlToPlainText undoes the render for the plain-text fallback', () => {
  assert.equal(telegramHtmlToPlainText('<b>Off</b> until <code>Thu</code>'), 'Off until Thu');
  assert.equal(telegramHtmlToPlainText('<pre>a &amp; b &lt;x&gt;</pre>'), 'a & b <x>');
  assert.equal(telegramHtmlToPlainText('<a href="http://x">link</a>'), 'link');
});

// ── grid parsing ────────────────────────────────────────────────────────

test('isMarkdownGridSeparatorRow accepts one-or-more dashes and alignment colons', () => {
  assert.equal(isMarkdownGridSeparatorRow('|--|--|'), true);
  assert.equal(isMarkdownGridSeparatorRow('| --- | --- |'), true);
  assert.equal(isMarkdownGridSeparatorRow('|:---|---:|:--:|'), true);
  assert.equal(isMarkdownGridSeparatorRow('|-|-|'), true);
  assert.equal(isMarkdownGridSeparatorRow('| a | b |'), false);
  assert.equal(isMarkdownGridSeparatorRow('no pipes here'), false);
  assert.equal(isMarkdownGridSeparatorRow('| | |'), false);
});

test('isMarkdownGridSeparatorRow needs EVERY cell to be a rule, anchored end to end', () => {
  assert.equal(isMarkdownGridSeparatorRow('| --- | b |'), false);
  assert.equal(isMarkdownGridSeparatorRow('| x--- | --- |'), false);
  assert.equal(isMarkdownGridSeparatorRow('| ---x | --- |'), false);
});

test('parseMarkdownGridRow trims cells and tolerates missing outer pipes', () => {
  assert.deepEqual(parseMarkdownGridRow('| Off | now |'), ['Off', 'now']);
  assert.deepEqual(parseMarkdownGridRow('Off | now'), ['Off', 'now']);
  assert.deepEqual(parseMarkdownGridRow('| | |'), ['', '']);
  assert.equal(parseMarkdownGridRow('no pipes here'), undefined);
});

test('parseMarkdownGridRow strips the outer pipes independently of each other', () => {
  assert.deepEqual(parseMarkdownGridRow('Off | now |'), ['Off', 'now']);
  assert.deepEqual(parseMarkdownGridRow('| Off | now'), ['Off', 'now']);
  assert.deepEqual(parseMarkdownGridRow('   | Off | now |   '), ['Off', 'now']);
});

test('takeMarkdownGrid reads a header, separator and body rows, stopping at the first non-row', () => {
  const lines = ['| Stage | Result |', '|--|--|', '| Cleaner | PASS |', '| QA | PASS |', '', 'after the grid'];
  const taken = takeMarkdownGrid(lines, 0);
  assert.deepEqual(taken.grid, {
    header: ['Stage', 'Result'],
    rows: [
      ['Cleaner', 'PASS'],
      ['QA', 'PASS'],
    ],
  });
  assert.equal(taken.next, 4);
});

test('takeMarkdownGrid treats an all-blank header as no header at all', () => {
  const taken = takeMarkdownGrid(['| | |', '|--|--|', '| Off | now |'], 0);
  assert.deepEqual(taken.grid, { header: [], rows: [['Off', 'now']] });
});

test('takeMarkdownGrid needs a separator row: a lone piped line is not a grid', () => {
  assert.equal(takeMarkdownGrid(['| Stage | Result |', 'plain text'], 0), undefined);
  assert.equal(takeMarkdownGrid(['plain text', '|--|--|'], 0), undefined);
});

test('takeMarkdownGrid refuses a separator row as its own header', () => {
  assert.equal(takeMarkdownGrid(['|--|--|', '|--|--|', '| a | b |'], 0), undefined);
});

test('takeMarkdownGrid stops at a separator row that reappears mid-body', () => {
  const taken = takeMarkdownGrid(['| a | b |', '|--|--|', '| 1 | 2 |', '|--|--|', '| 3 | 4 |'], 0);
  assert.deepEqual(taken.grid.rows, [['1', '2']]);
  assert.equal(taken.next, 3);
});

test('takeMarkdownGrid needs a line after the header: a truncated grid is not one', () => {
  assert.equal(takeMarkdownGrid(['| a | b |'], 0), undefined);
  assert.equal(takeMarkdownGrid(['prose', '| a | b |'], 1), undefined);
});

test('takeMarkdownGrid accepts a header-and-rule grid carrying no body rows', () => {
  const taken = takeMarkdownGrid(['| a | b |', '|--|--|'], 0);
  assert.deepEqual(taken, { grid: { header: ['a', 'b'], rows: [] }, next: 2 });
});

test('takeMarkdownGrid keeps a header where only some cells are filled', () => {
  const taken = takeMarkdownGrid(['| Stage | |', '|--|--|', '| QA | ok |'], 0);
  assert.deepEqual(taken.grid.header, ['Stage', '']);
});

test('takeMarkdownGrid reads body rows from the separator down, never the header again', () => {
  const taken = takeMarkdownGrid(['| a | b |', '|--|--|', '| 1 | 2 |'], 0);
  assert.deepEqual(taken.grid.rows, [['1', '2']]);
  assert.equal(taken.next, 3);
});

test('takeMarkdownGrid pads short rows out to the widest row', () => {
  const taken = takeMarkdownGrid(['| a | b |', '|--|--|', '| only |'], 0);
  assert.deepEqual(taken.grid.rows, [['only', '']]);
});

// ── monospace render ────────────────────────────────────────────────────

test('renderGridAsMonospace aligns columns and rules off a real header', () => {
  const grid = {
    header: ['Stage', 'Result'],
    rows: [
      ['Cleaner', 'PASS'],
      ['QA', 'OK'],
    ],
  };
  assert.equal(
    renderGridAsMonospace(grid),
    ['Stage   | Result', '--------+-------', 'Cleaner | PASS', 'QA      | OK'].join('\n')
  );
});

test('renderGridAsMonospace omits the rule when the grid has no header', () => {
  const grid = { header: [], rows: [['Off', 'now'], ['Next', 'Thursday']] };
  assert.equal(renderGridAsMonospace(grid), ['Off  | now', 'Next | Thursday'].join('\n'));
});

test('renderGridAsMonospace strips cell markdown so no marker survives into the block', () => {
  const grid = { header: [], rows: [['Off', '**now** and `code`']] };
  assert.equal(renderGridAsMonospace(grid), 'Off | now and code');
});

test('renderGridAsMonospace re-trims a cell left padded by its own stripped markers', () => {
  assert.equal(renderGridAsMonospace({ header: [], rows: [['Off', '** now **']] }), 'Off | now');
});

test('renderGridAsMonospace pads a ragged row out to the header it belongs to', () => {
  assert.equal(
    renderGridAsMonospace({ header: ['Aa', 'Bbbb'], rows: [['x']] }),
    ['Aa | Bbbb', '---+-----', 'x'].join('\n')
  );
});

test('renderGridAsMonospace pads an empty middle cell with plain spaces', () => {
  assert.equal(
    renderGridAsMonospace({ header: [], rows: [['a', '', 'c'], ['a', 'bb', 'c']] }),
    ['a |    | c', 'a | bb | c'].join('\n')
  );
});

test('renderGridAsMonospace protects a leading blank cell that Telegram would collapse', () => {
  const grid = { header: [], rows: [['', 'value'], ['wide', 'x']] };
  assert.equal(renderGridAsMonospace(grid), ['\u00a0\u00a0\u00a0\u00a0 | value', 'wide | x'].join('\n'));
});

test('gridWidth measures the widest rendered line', () => {
  assert.equal(gridWidth({ header: [], rows: [['Off', 'now']] }), 'Off | now'.length);
});

// ── html render ─────────────────────────────────────────────────────────

test('renderMarkdownGridHtml wraps a phone-width grid in one escaped pre block', () => {
  const html = renderMarkdownGridHtml({ header: ['A', 'B'], rows: [['<x>', 'y & z']] });
  assert.equal(html, ['<pre>A   | B', '----+------', '&lt;x&gt; | y &amp; z</pre>'].join('\n'));
});

test('renderMarkdownGridHtml stacks one labelled block per row when the grid cannot fit a phone', () => {
  const grid = {
    header: ['Gate', 'Result', 'Detail'],
    rows: [
      ['Coverage', 'PASS', 'ninety nine point one percent of statements covered'],
      ['Mutation', 'PASS', 'zero survivors on the pilot module after the rewrite'],
    ],
  };
  assert.ok(gridWidth(grid) > TELEGRAM_GRID_MAX_WIDTH);
  assert.equal(
    renderMarkdownGridHtml(grid),
    [
      '<b>Coverage</b>',
      'Result: PASS',
      'Detail: ninety nine point one percent of statements covered',
      '',
      '<b>Mutation</b>',
      'Result: PASS',
      'Detail: zero survivors on the pilot module after the rewrite',
    ].join('\n')
  );
});

test('renderGridAsStackedHtml without a header lists the remaining cells bare and escapes them', () => {
  assert.equal(
    renderGridAsStackedHtml({ header: [], rows: [['Off', 'now & <then>']] }),
    ['<b>Off</b>', 'now &amp; &lt;then&gt;'].join('\n')
  );
});

test('renderGridAsStackedHtml skips empty cells rather than posting bare labels', () => {
  assert.equal(
    renderGridAsStackedHtml({ header: ['A', 'B', 'C'], rows: [['row', '', 'kept']] }),
    ['<b>row</b>', 'C: kept'].join('\n')
  );
});

test('renderGridAsStackedHtml labels each cell with its OWN header column', () => {
  assert.equal(
    renderGridAsStackedHtml({ header: ['A', 'B', 'C'], rows: [['row', 'first', 'second']] }),
    ['<b>row</b>', 'B: first', 'C: second'].join('\n')
  );
});

test('renderGridAsStackedHtml leaves a cell past the header end unlabelled', () => {
  assert.equal(
    renderGridAsStackedHtml({ header: ['A'], rows: [['row', 'extra']] }),
    ['<b>row</b>', 'extra'].join('\n')
  );
});

test('renderGridAsStackedHtml titles an empty row with an empty title', () => {
  assert.equal(renderGridAsStackedHtml({ header: [], rows: [[]] }), '<b></b>');
});

test('renderMarkdownGridHtml keeps a grid exactly at the width budget as a monospace block', () => {
  const grid = { header: [], rows: [['Off', 'now']] };
  const width = gridWidth(grid);
  assert.equal(renderMarkdownGridHtml(grid, width), '<pre>Off | now</pre>');
  assert.equal(renderMarkdownGridHtml(grid, width - 1), '<b>Off</b>\nnow');
});

// ── inline markdown ─────────────────────────────────────────────────────

test('inlineMarkdownToTelegramHtml converts emphasis, code, strike and links', () => {
  assert.equal(inlineMarkdownToTelegramHtml('**bold**'), '<b>bold</b>');
  assert.equal(inlineMarkdownToTelegramHtml('__also bold__'), '<b>also bold</b>');
  assert.equal(inlineMarkdownToTelegramHtml('*italic*'), '<i>italic</i>');
  assert.equal(inlineMarkdownToTelegramHtml('~~gone~~'), '<s>gone</s>');
  assert.equal(inlineMarkdownToTelegramHtml('`npm run compile`'), '<code>npm run compile</code>');
  assert.equal(
    inlineMarkdownToTelegramHtml('[the ticket](https://example.com/a?b=1&c=2)'),
    '<a href="https://example.com/a?b=1&amp;c=2">the ticket</a>'
  );
});

test('inlineMarkdownToTelegramHtml leaves snake_case identifiers and bare stars alone', () => {
  assert.equal(inlineMarkdownToTelegramHtml('run_id and last_incident'), 'run_id and last_incident');
  assert.equal(inlineMarkdownToTelegramHtml('2 * 3 * 4'), '2 * 3 * 4');
});

test('inlineMarkdownToTelegramHtml italicises a word surrounded by spaces mid-sentence', () => {
  assert.equal(inlineMarkdownToTelegramHtml('a *b* c'), 'a <i>b</i> c');
  assert.equal(inlineMarkdownToTelegramHtml('star*inside*word'), 'star*inside*word');
});

test('inlineMarkdownToTelegramHtml never converts markers inside inline code', () => {
  assert.equal(
    inlineMarkdownToTelegramHtml('`a **b** c` then **d**'),
    '<code>a **b** c</code> then <b>d</b>'
  );
});

test('inlineMarkdownToTelegramHtml escapes the angle brackets it does not own', () => {
  assert.equal(inlineMarkdownToTelegramHtml('role <none> & done'), 'role &lt;none&gt; &amp; done');
});

// ── whole message ───────────────────────────────────────────────────────

test('markdownToTelegramHtml renders a grid, a heading and prose together', () => {
  const md = ['## Vacation', '', '| | |', '|--|--|', '| Off | now |', '', 'Cron parked.'].join('\n');
  assert.equal(
    markdownToTelegramHtml(md),
    ['<b>Vacation</b>', '', '<pre>Off | now</pre>', '', 'Cron parked.'].join('\n')
  );
});

test('markdownToTelegramHtml keeps a fenced code block as a monospace block', () => {
  const md = ['before', '```bash', './start-swarm.sh <root>', '```', 'after'].join('\n');
  assert.equal(
    markdownToTelegramHtml(md),
    ['before', '<pre>./start-swarm.sh &lt;root&gt;</pre>', 'after'].join('\n')
  );
});

test('markdownToTelegramHtml keeps the line breaks inside a fenced block', () => {
  assert.equal(
    markdownToTelegramHtml(['```', 'one', 'two', '```'].join('\n')),
    '<pre>one\ntwo</pre>'
  );
});

test('markdownToTelegramHtml honours an indented fence, opening and closing', () => {
  assert.equal(markdownToTelegramHtml(['  ```', 'body', '  ```', 'after'].join('\n')), '<pre>body</pre>\nafter');
});

test('markdownToTelegramHtml only fences on a line that STARTS with the fence', () => {
  assert.equal(markdownToTelegramHtml(['a ``` b', 'plain'].join('\n')), ['a ``` b', 'plain'].join('\n'));
  assert.equal(
    markdownToTelegramHtml(['```', 'a ``` b', '```', 'after'].join('\n')),
    '<pre>a ``` b</pre>\nafter'
  );
});

test('markdownToTelegramHtml closes an unterminated fence instead of leaking markup', () => {
  assert.equal(markdownToTelegramHtml(['```', 'tail line'].join('\n')), '<pre>tail line</pre>');
});

test('markdownToTelegramHtml drops a thematic break and list markers survive as text', () => {
  assert.equal(markdownToTelegramHtml(['a', '---', '- one', '- two'].join('\n')), ['a', '- one', '- two'].join('\n'));
});

test('markdownToTelegramHtml drops an indented or space-trailed break, keeps dashes in prose', () => {
  assert.equal(markdownToTelegramHtml(['a', '   ---', 'b'].join('\n')), ['a', 'b'].join('\n'));
  assert.equal(markdownToTelegramHtml(['a', '--- ', 'b'].join('\n')), ['a', 'b'].join('\n'));
  assert.equal(markdownToTelegramHtml('note ---'), 'note ---');
  assert.equal(markdownToTelegramHtml('--- note'), '--- note');
});

test('markdownToTelegramHtml only reads a heading from the start of the line', () => {
  assert.equal(markdownToTelegramHtml('see # 12'), 'see # 12');
  assert.equal(markdownToTelegramHtml('  ## Indented'), '<b>Indented</b>');
  assert.equal(markdownToTelegramHtml('##   Padded'), '<b>Padded</b>');
});

test('markdownToTelegramHtml leaves ordinary prose escaped but otherwise untouched', () => {
  assert.equal(markdownToTelegramHtml('swarm stopped; 2 < 3'), 'swarm stopped; 2 &lt; 3');
  assert.equal(markdownToTelegramHtml(''), '');
});

// ── send-failure classification ─────────────────────────────────────────

test('shouldRetryTelegramPostAsPlainText retries a formatting rejection', () => {
  assert.equal(
    shouldRetryTelegramPostAsPlainText("Telegram API 400: Bad Request: can't parse entities: unsupported start tag"),
    true
  );
  assert.equal(shouldRetryTelegramPostAsPlainText('Bad Request: unsupported start tag "x"'), true);
  assert.equal(shouldRetryTelegramPostAsPlainText(undefined), true);
});

test('shouldRetryTelegramPostAsPlainText leaves a transient failure alone', () => {
  assert.equal(shouldRetryTelegramPostAsPlainText('Telegram API 429: Too Many Requests: retry after 12'), false);
  assert.equal(shouldRetryTelegramPostAsPlainText('Telegram API 502: Bad Gateway'), false);
  assert.equal(shouldRetryTelegramPostAsPlainText('Telegram request failed: ECONNRESET'), false);
  assert.equal(shouldRetryTelegramPostAsPlainText('Telegram request failed: request timed out'), false);
  assert.equal(shouldRetryTelegramPostAsPlainText('Telegram request failed: timeout'), false);
});

// ── chunking ────────────────────────────────────────────────────────────

test('splitTelegramHtmlChunks returns one chunk when the message fits', () => {
  assert.deepEqual(splitTelegramHtmlChunks('<b>x</b>', 100), ['<b>x</b>']);
});

test('splitTelegramHtmlChunks splits on line boundaries', () => {
  const html = ['aaaa', 'bbbb', 'cccc'].join('\n');
  assert.deepEqual(splitTelegramHtmlChunks(html, 10), ['aaaa\nbbbb', 'cccc']);
  assert.deepEqual(splitTelegramHtmlChunks(html, 9), ['aaaa\nbbbb', 'cccc']);
  assert.deepEqual(splitTelegramHtmlChunks(html, 8), ['aaaa', 'bbbb', 'cccc']);
});

test('splitTelegramHtmlChunks yields nothing for an empty message', () => {
  assert.deepEqual(splitTelegramHtmlChunks('', 10), []);
});

test('splitTelegramHtmlChunks never breaks a pre block across chunks', () => {
  const html = ['<pre>one\ntwo</pre>', 'tail'].join('\n');
  assert.deepEqual(splitTelegramHtmlChunks(html, 20), ['<pre>one\ntwo</pre>', 'tail']);
});

test('splitTelegramHtmlChunks re-wraps an oversized pre block as several pre blocks', () => {
  const html = '<pre>aaaaaaaa\nbbbbbbbb\ncccccccc</pre>';
  assert.deepEqual(splitTelegramHtmlChunks(html, 30), [
    '<pre>aaaaaaaa\nbbbbbbbb</pre>',
    '<pre>cccccccc</pre>',
  ]);
  assert.deepEqual(splitTelegramHtmlChunks(html, 28), [
    '<pre>aaaaaaaa\nbbbbbbbb</pre>',
    '<pre>cccccccc</pre>',
  ]);
  assert.deepEqual(splitTelegramHtmlChunks(html, 27), [
    '<pre>aaaaaaaa</pre>',
    '<pre>bbbbbbbb</pre>',
    '<pre>cccccccc</pre>',
  ]);
});

test('splitTelegramHtmlChunks re-wraps a single-line pre block that will not fit', () => {
  assert.deepEqual(splitTelegramHtmlChunks('<pre>aaaa</pre>\ntail', 15), ['<pre>aaaa</pre>', 'tail']);
});

test('splitTelegramHtmlChunks keeps an unbreakable pre line whole rather than corrupt it', () => {
  assert.deepEqual(splitTelegramHtmlChunks('<pre>aaaaaaaaaaaa</pre>', 10), ['<pre>aaaaaaaaaaaa</pre>']);
});

test('splitTelegramHtmlChunks closes a pre block the render left open', () => {
  assert.deepEqual(splitTelegramHtmlChunks('<pre>one\ntwo', 8), ['<pre>one</pre>', '<pre>two</pre>']);
});

test('splitTelegramHtmlChunks hard-splits a single line with no break to use', () => {
  assert.deepEqual(splitTelegramHtmlChunks('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(splitTelegramHtmlChunks('abcdefgh', 4), ['abcd', 'efgh']);
});

test('splitTelegramHtmlChunks flushes a full chunk before an empty line it cannot hold', () => {
  assert.deepEqual(splitTelegramHtmlChunks('aaaa\n\nbbbb', 4), ['aaaa', 'bbbb']);
});
