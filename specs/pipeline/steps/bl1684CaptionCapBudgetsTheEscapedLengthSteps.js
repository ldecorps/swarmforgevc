'use strict';

// BL-1684: step handlers for "The pipeline board's caption cap budgets the
// rendered length and the message never exceeds its limit". Drives the REAL
// compiled extension/out/concierge/pipelineBoard.js module - never a
// reimplementation of computePipelineBoard, truncateCaptionDescription, or
// composePipelineBoardHtml. Scenario 02 replays the SAME fast-check
// arbitrary shape the coder-authored bl956 property test itself uses
// (test/bl956PipelineBoardCaptionCapInvariants.property.test.js) at the
// pinned seed - a fixture-generation shape, not the production decision
// under test, so duplicating it here (rather than importing the test file,
// which is not designed to be required as a module) is not a
// reimplementation of anything this ticket's invariant actually decides.

const assert = require('node:assert/strict');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const MODULE_PATH = path.join(EXTENSION_DIR, 'out', 'concierge', 'pipelineBoard');
// fast-check lives only under extension/node_modules - not resolvable from
// specs/pipeline/steps' own node_modules chain (bl1247's own idiom).
const fc = require(path.join(EXTENSION_DIR, 'node_modules', 'fast-check'));

const FEATURE = "BL-1684 The pipeline board's caption cap budgets the rendered length and the message never exceeds its limit";

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the compiled pipeline board module$/, (ctx) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    ctx.pb = require(MODULE_PATH);
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(
    /^a board of fifteen active rows whose titles are long runs of ampersands and less-than signs, three plain parked tickets and four epic trackers$/,
    (ctx) => {
      const { computePipelineBoard } = ctx.pb;
      const activeIds = Array.from({ length: 15 }, (_, i) => `BL-${100 + i}`);
      const ticketMeta = {};
      activeIds.forEach((id, i) => {
        const filler = i % 2 === 0 ? '&' : '<';
        ticketMeta[id] = { title: filler.repeat(200), filename: `${id}-x.yaml`, location: 'active' };
      });
      const paused = [
        ...Array.from({ length: 3 }, (_, i) => ({ id: `BL-${300 + i}`, priority: i })),
        ...Array.from({ length: 4 }, (_, i) => ({ id: `BL-${400 + i}`, type: 'epic', epic: `epic-${i}`, priority: i })),
      ];
      paused.forEach((item) => {
        ticketMeta[item.id] = { title: '&'.repeat(200), epic: item.epic, filename: `${item.id}-x.yaml`, location: 'paused' };
      });
      ctx.data = computePipelineBoard({}, paused, ticketMeta, { activeIds });
    },
  );

  scoped(/^the board message is composed with no link list$/, (ctx) => {
    const { composePipelineBoardHtml } = ctx.pb;
    const { html } = composePipelineBoardHtml(ctx.data, 0, undefined);
    ctx.composedHtml = html;
  });

  scoped(/^the composed html is at most the message limit$/, (ctx) => {
    const { PIPELINE_BOARD_MESSAGE_MAX_LENGTH } = ctx.pb;
    assert.ok(
      ctx.composedHtml.length <= PIPELINE_BOARD_MESSAGE_MAX_LENGTH,
      `expected at most ${PIPELINE_BOARD_MESSAGE_MAX_LENGTH} chars, got ${ctx.composedHtml.length}`,
    );
  });

  scoped(/^every caption line still ends in the ellipsis that marks the cap$/, (ctx) => {
    const lines = ctx.composedHtml.split('\n').filter((l) => /^\d+ /.test(l));
    assert.ok(lines.length > 0, `expected at least one caption line, got:\n${ctx.composedHtml}`);
    for (const line of lines) {
      assert.ok(line.endsWith('…'), `expected caption line to end with the ellipsis, got: ${JSON.stringify(line)}`);
    }
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the bl956 caption-cap property's invariant 1 runs at seed (\d+) for (\d+) runs$/, (ctx, seedStr, runsStr) => {
    const { computePipelineBoard, composePipelineBoardHtml, PIPELINE_BOARD_MESSAGE_MAX_LENGTH } = ctx.pb;

    const titleArb = fc
      .record({
        length: fc.oneof(fc.integer({ min: 0, max: 80 }), fc.integer({ min: 1000, max: 5000 })),
        filler: fc.constantFrom('x', '&', '<', 'word '),
      })
      .map(({ length, filler }) => filler.repeat(Math.ceil(length / filler.length)).slice(0, length));

    const boardArb = fc.record({
      activeCount: fc.integer({ min: 1, max: 15 }),
      titles: fc.array(titleArb, { minLength: 15, maxLength: 15 }),
      withMeta: fc.array(fc.boolean(), { minLength: 15, maxLength: 15 }),
      epics: fc.array(fc.constantFrom('concerto', 'fugue', undefined), { minLength: 15, maxLength: 15 }),
      plainParkedCount: fc.integer({ min: 0, max: 8 }),
      epicTrackerCount: fc.integer({ min: 0, max: 8 }),
    });

    function buildBoard(shape) {
      const activeIds = Array.from({ length: shape.activeCount }, (_, i) => `BL-${100 + i}`);
      const ticketMeta = {};
      activeIds.forEach((id, i) => {
        if (shape.withMeta[i]) {
          ticketMeta[id] = { title: shape.titles[i], epic: shape.epics[i], filename: `${id}-x.yaml`, location: 'active' };
        }
      });
      const paused = [
        ...Array.from({ length: shape.plainParkedCount }, (_, i) => ({ id: `BL-${300 + i}`, priority: i })),
        ...Array.from({ length: shape.epicTrackerCount }, (_, i) => ({ id: `BL-${400 + i}`, type: 'epic', epic: `epic-${i}`, priority: i })),
      ];
      paused.forEach((item) => {
        ticketMeta[item.id] = { title: shape.titles[0], epic: item.epic, filename: `${item.id}-x.yaml`, location: 'paused' };
      });
      return computePipelineBoard({}, paused, ticketMeta, { activeIds });
    }

    ctx.propertyResult = { threw: null };
    try {
      fc.assert(
        fc.property(boardArb, (shape) => {
          const data = buildBoard(shape);
          const { html } = composePipelineBoardHtml(data, 0, 'https://github.com/x/y');
          assert.ok(html.length <= PIPELINE_BOARD_MESSAGE_MAX_LENGTH, `composed ${html.length} chars > ${PIPELINE_BOARD_MESSAGE_MAX_LENGTH}`);
        }),
        { seed: Number(seedStr), numRuns: Number(runsStr) },
      );
    } catch (err) {
      ctx.propertyResult.threw = err;
    }
  });

  scoped(/^it passes$/, (ctx) => {
    assert.equal(ctx.propertyResult.threw, null, `expected the property to pass, got: ${ctx.propertyResult.threw && ctx.propertyResult.threw.message}`);
  });
}

module.exports = { registerSteps };
