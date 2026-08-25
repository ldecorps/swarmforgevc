'use strict';

// BL-723: unit coverage for the pure markdown/YAML-block parsing helpers
// bl723PilotReviewSteps.js relies on. Manual acceptance runs while wiring
// this file surfaced two real bugs this test locks down: (1) a
// "**Filed defects:**" line that wraps onto a second physical line used to
// silently drop everything after the wrap, and (2) the overall-verdict
// regex must not confuse "ON PAR" with "NOT ON PAR".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseReviewLikeDocument, extractTopLevelBlock } = require('../../steps/bl723PilotReviewSteps');

test('parseReviewLikeDocument reads the overall verdict, NOT ON PAR case', () => {
  const doc = parseReviewLikeDocument('**Overall verdict:** NOT ON PAR\n\n**Verdict reasons:**\nsome text\n');
  assert.equal(doc.overallVerdict, 'not-on-par');
});

test('parseReviewLikeDocument reads the overall verdict, ON PAR case', () => {
  const doc = parseReviewLikeDocument('**Overall verdict:** ON PAR\n\n**Verdict reasons:**\nsome text\n');
  assert.equal(doc.overallVerdict, 'on-par');
});

test('parseReviewLikeDocument returns null overall verdict when absent', () => {
  const doc = parseReviewLikeDocument('no verdict marker here at all\n');
  assert.equal(doc.overallVerdict, null);
});

test('parseReviewLikeDocument captures verdict reasons up to the next marker', () => {
  const text = '**Verdict reasons:**\nline one\nline two\n\n**Process:** something else entirely\n';
  const doc = parseReviewLikeDocument(text);
  assert.ok(doc.reasonsText.includes('line one'));
  assert.ok(doc.reasonsText.includes('line two'));
  assert.ok(!doc.reasonsText.includes('Process'));
});

test('parseReviewLikeDocument maps a viewpoint heading to its seat, case-insensitively', () => {
  const text = '### QA viewpoint\nqa body text\n\n### Hardender viewpoint\nhardener body text\n';
  const doc = parseReviewLikeDocument(text);
  assert.equal(doc.viewpoints.get('qa').body.trim(), 'qa body text');
  assert.equal(doc.viewpoints.get('hardender').body.trim(), 'hardener body text');
  assert.equal(doc.viewpoints.size, 2);
});

test('parseReviewLikeDocument maps a BL-#### heading to a per-ticket verdict entry', () => {
  const text = '### BL-718\n**Verdict:** not-on-par\n\nsome reasons\n\n**Filed defects:** BL-726 (remaining work), BL-727 (pilot process)\n';
  const doc = parseReviewLikeDocument(text);
  const entry = doc.perTicket.get('BL-718');
  assert.ok(entry, 'expected a BL-718 entry');
  assert.equal(entry.verdict, 'not-on-par');
  assert.deepEqual(entry.filedDefects, ['BL-726', 'BL-727']);
});

test('parseReviewLikeDocument does not truncate a "Filed defects:" line that wraps onto a second physical line', () => {
  // Regression: the original regex used `.+` (single-line only) and
  // silently dropped BL-731 when the source line wrapped for readability.
  const text = '### BL-637\n**Verdict:** not-on-par\n\n**Filed defects:** BL-730 (remaining work, severity high)\nand BL-731 (pilot process)\n';
  const doc = parseReviewLikeDocument(text);
  assert.deepEqual(doc.perTicket.get('BL-637').filedDefects, ['BL-730', 'BL-731']);
});

test('parseReviewLikeDocument records an empty filedDefects list when the ticket has none', () => {
  const text = '### BL-641\n**Verdict:** on-par\n\nno concerns\n\n**Filed defects:** none\n';
  const doc = parseReviewLikeDocument(text);
  assert.deepEqual(doc.perTicket.get('BL-641').filedDefects, []);
});

test('parseReviewLikeDocument reports the first non-empty line, skipping leading blank lines', () => {
  const doc = parseReviewLikeDocument('\n\n  \nHeadline text here\nmore text\n');
  assert.equal(doc.firstNonEmptyLine, 'Headline text here');
});

test('extractTopLevelBlock returns a block scalar through to the next top-level key', () => {
  const text = 'id: BL-1\ndescription: |\n  line one\n  line two\nacceptance: something\n';
  const block = extractTopLevelBlock(text, 'description');
  assert.equal(block, 'description: |\n  line one\n  line two');
});

test('extractTopLevelBlock returns the block through EOF when it is the last key', () => {
  const text = 'id: BL-1\nnotes: |\n  a note\n  more note\n';
  const block = extractTopLevelBlock(text, 'notes');
  assert.equal(block, 'notes: |\n  a note\n  more note');
});

test('extractTopLevelBlock returns null when the key is absent', () => {
  const text = 'id: BL-1\ndescription: |\n  text\n';
  assert.equal(extractTopLevelBlock(text, 'acceptance'), null);
});
