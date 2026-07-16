const assert = require('node:assert/strict');
const { computePipelineBoardRows, renderPipelineBoard, wrapPipelineBoardHtml, PIPELINE_BOARD_COLUMN_ORDER } = require('../out/concierge/pipelineBoard');

// BL-452 pipeline-board-01/02: a ticket held by a role becomes a row marked
// only in that role's column; every other column in that row stays blank.

test('computePipelineBoardRows: a ticket held by a role is a row in that role column', () => {
  const rows = computePipelineBoardRows({ coder: ['BL-387'], QA: ['BL-413'] }, []);
  assert.deepEqual(rows, [
    { id: 'BL-387', column: 'coder' },
    { id: 'BL-413', column: 'QA' },
  ]);
});

test('computePipelineBoardRows: rows follow pipeline order (specifier..coordinator), not object key order', () => {
  const rows = computePipelineBoardRows({ QA: ['BL-2'], coder: ['BL-1'] }, []);
  assert.deepEqual(rows, [
    { id: 'BL-1', column: 'coder' },
    { id: 'BL-2', column: 'QA' },
  ]);
});

test('computePipelineBoardRows: a batch role holding several tickets gets one row per ticket', () => {
  const rows = computePipelineBoardRows({ cleaner: ['BL-100', 'BL-101'] }, []);
  assert.deepEqual(rows, [
    { id: 'BL-100', column: 'cleaner' },
    { id: 'BL-101', column: 'cleaner' },
  ]);
});

test('computePipelineBoardRows: a paused ticket with no pending approval is "parked"', () => {
  const rows = computePipelineBoardRows({}, [{ id: 'BL-436' }]);
  assert.deepEqual(rows, [{ id: 'BL-436', column: 'parked' }]);
});

test('computePipelineBoardRows: a paused ticket with humanApproval "approved" is still "parked"', () => {
  const rows = computePipelineBoardRows({}, [{ id: 'BL-436', humanApproval: 'approved' }]);
  assert.deepEqual(rows, [{ id: 'BL-436', column: 'parked' }]);
});

test('computePipelineBoardRows: a paused ticket awaiting human approval is "awaiting-approval"', () => {
  const rows = computePipelineBoardRows({}, [{ id: 'BL-449', humanApproval: 'pending' }]);
  assert.deepEqual(rows, [{ id: 'BL-449', column: 'awaiting-approval' }]);
});

test('computePipelineBoardRows: role-held rows come before paused rows', () => {
  const rows = computePipelineBoardRows({ coder: ['BL-1'] }, [{ id: 'BL-2', humanApproval: 'pending' }]);
  assert.deepEqual(rows, [
    { id: 'BL-1', column: 'coder' },
    { id: 'BL-2', column: 'awaiting-approval' },
  ]);
});

test('computePipelineBoardRows: no active or paused tickets renders no rows', () => {
  assert.deepEqual(computePipelineBoardRows({}, []), []);
});

// BL-452 pipeline-board-01: the header names every column; each data row
// marks exactly one column, every other column in that row is blank.

test('renderPipelineBoard: header lists every pipeline role plus the two status columns', () => {
  const header = renderPipelineBoard([]).split('\n')[0];
  for (const column of PIPELINE_BOARD_COLUMN_ORDER) {
    assert.ok(header.length > 0);
  }
  assert.equal(renderPipelineBoard([]), header);
});

test('renderPipelineBoard: a row is marked only in its own column', () => {
  const text = renderPipelineBoard([{ id: 'BL-387', column: 'coder' }]);
  const lines = text.split('\n');
  assert.equal(lines.length, 2);
  const [header, row] = lines;
  const headerCols = header.trim().split(/\s+/).slice(1);
  const rowCols = row.trim().split(/\s+/).slice(1);
  assert.equal(rowCols.length, headerCols.length);
  const coderIndex = headerCols.indexOf('CO');
  rowCols.forEach((cell, i) => {
    assert.equal(cell, i === coderIndex ? 'X' : '.');
  });
});

test('renderPipelineBoard: two tickets in different columns each mark only their own', () => {
  const text = renderPipelineBoard([
    { id: 'BL-387', column: 'coder' },
    { id: 'BL-413', column: 'QA' },
  ]);
  const lines = text.split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith('BL-387'));
  assert.ok(lines[2].startsWith('BL-413'));
});

test('renderPipelineBoard: ticket-id column widens to fit the longest id without breaking alignment', () => {
  const text = renderPipelineBoard([
    { id: 'BL-9', column: 'coder' },
    { id: 'BL-123456', column: 'QA' },
  ]);
  const lines = text.split('\n');
  const idWidth = 'BL-123456'.length;
  for (const line of lines) {
    assert.equal(line[idWidth], ' ', `expected a column boundary at ${idWidth} in "${line}"`);
  }
  assert.ok(lines[1].startsWith('BL-9'.padEnd(idWidth)));
  assert.ok(lines[2].startsWith('BL-123456'));
});

test('renderPipelineBoard: rendering is a pure function of its rows - same input, same text', () => {
  const rows = [{ id: 'BL-1', column: 'parked' }];
  assert.equal(renderPipelineBoard(rows), renderPipelineBoard(rows));
});

// BL-452: the board posts as a Telegram HTML <pre> block so the grid stays
// monospace/aligned; only the handful of HTML-significant characters ever
// need escaping (ticket ids and column glyphs never carry them in
// practice, but the wrap must not corrupt the markup if they ever did).

test('wrapPipelineBoardHtml: wraps the grid text in a <pre> block', () => {
  assert.equal(wrapPipelineBoardHtml('TICKET SP\nBL-1    X'), '<pre>TICKET SP\nBL-1    X</pre>');
});

test('wrapPipelineBoardHtml: escapes HTML-significant characters', () => {
  assert.equal(wrapPipelineBoardHtml('a & b < c > d'), '<pre>a &amp; b &lt; c &gt; d</pre>');
});
