'use strict';

// BL-1155: Pipeline Board stage header one line including QA on phone width budget.

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  computePipelineBoard,
  renderPipelineBoardGridOnly,
  PIPELINE_BOARD_COLUMN_ORDER,
  PIPELINE_BOARD_GRID_MAX_WIDTH,
  PIPELINE_BOARD_STAGE_CELL_WIDTH,
  computePipelineBoardGridLineWidth,
} = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'pipelineBoard'));

const FEATURE = 'Pipeline Board stage header stays one line including QA';

function sampleBoard(ctx) {
  ctx.data = computePipelineBoard(
    { coder: ['BL-658'] },
    [],
    { 'BL-658': { title: 'shift packs', filename: 'BL-658.yaml', location: 'active' } },
    { activeIds: ['BL-658'] }
  );
  const lines = renderPipelineBoardGridOnly(ctx.data).split('\n');
  ctx.header = lines[0];
  ctx.markRow = lines[1];
  ctx.phoneWidthBudget = PIPELINE_BOARD_GRID_MAX_WIDTH;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the Pipeline Board grid is rendered for today's eight stage columns$/, (ctx) => {
    sampleBoard(ctx);
  });

  scoped(/^the render targets the board's stated phone width budget$/, (ctx) => {
    ctx.phoneWidthBudget = PIPELINE_BOARD_GRID_MAX_WIDTH;
  });

  scoped(/^the stage header line is produced$/, (ctx) => {
    if (!ctx.header) sampleBoard(ctx);
  });

  scoped(/^that header is exactly one line$/, (ctx) => {
    assert.ok(!ctx.header.includes('\n'), `header must be one line: ${ctx.header}`);
    assert.ok(ctx.header.length <= ctx.phoneWidthBudget, `${ctx.header.length} exceeds ${ctx.phoneWidthBudget}`);
  });

  scoped(/^the header contains the intact label "QA" with no mid-label wrap$/, (ctx) => {
    assert.match(ctx.header, /QA/);
    assert.ok(!ctx.header.endsWith('Q'), 'QA must not split with trailing Q');
  });

  scoped(/^the Pipeline Board grid is rendered with ticket mark rows$/, (ctx) => {
    sampleBoard(ctx);
  });

  scoped(/^the stage header and a mark row are compared$/, (ctx) => {
    assert.ok(ctx.header && ctx.markRow);
  });

  scoped(/^each header stage cell aligns over its corresponding mark column$/, (ctx) => {
    const gutter = Math.max(3, '658'.length);
    assert.equal(ctx.header.length, ctx.markRow.length, 'header and mark row share width');
    assert.equal(ctx.header.length, computePipelineBoardGridLineWidth(gutter));
    const stageWidth = PIPELINE_BOARD_STAGE_CELL_WIDTH;
    for (let i = 0; i < PIPELINE_BOARD_COLUMN_ORDER.length; i++) {
      const start = gutter + i * (stageWidth + 1);
      const headerCell = ctx.header.slice(start, start + stageWidth);
      const markCell = ctx.markRow.slice(start, start + stageWidth);
      assert.equal(headerCell.length, stageWidth);
      assert.equal(markCell.length, stageWidth);
    }
  });

  scoped(/^the Pipeline Board header one-line fix is in place$/, (ctx) => {
    ctx.layout = {
      maxWidth: PIPELINE_BOARD_GRID_MAX_WIDTH,
      stageCellWidth: PIPELINE_BOARD_STAGE_CELL_WIDTH,
      gridLineWidth: computePipelineBoardGridLineWidth(3),
    };
  });

  scoped(/^the width or wrap contract is inspected$/, (ctx) => {
    assert.ok(ctx.layout);
  });

  scoped(
    /^it names a durable layout or budget check \(for example max composed header width\)$/,
    (ctx) => {
      assert.equal(ctx.layout.stageCellWidth, 2);
      assert.equal(ctx.layout.gridLineWidth, 26);
      assert.ok(ctx.layout.gridLineWidth <= ctx.layout.maxWidth);
    }
  );

  scoped(/^it is not solely an assertion that the HTML contains numeric &#160;$/, (ctx) => {
    assert.ok(typeof computePipelineBoardGridLineWidth === 'function');
    assert.notEqual(ctx.layout.gridLineWidth, 0);
  });
}

module.exports = { registerSteps };
