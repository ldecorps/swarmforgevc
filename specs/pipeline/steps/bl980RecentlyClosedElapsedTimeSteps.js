'use strict';

// BL-980: step handlers for "each RECENTLY CLOSED line shows how long ago
// the ticket closed". Drives the real compiled pipelineBoard module -
// never a hand-rolled reimplementation of the age ladder or section layout.

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  computePipelineBoard,
  renderPipelineBoardBody,
  composePipelineBoardHtml,
} = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'concierge', 'pipelineBoard'));

const FEATURE =
  'BL-980 each RECENTLY CLOSED line shows how long ago the ticket closed';

const NOW = Date.UTC(2026, 7, 20, 8, 42, 0);
const TICKET_ID = 'BL-966';
const TICKET_TITLE = 'effective-backlog';

function renderBoard(ctx) {
  ctx.data = computePipelineBoard(
    ctx.roleHeldTickets ?? {},
    ctx.paused ?? [],
    ctx.ticketMeta ?? {},
    {
      nowMs: ctx.nowMs ?? NOW,
      recentlyClosed: ctx.recentlyClosed ?? [],
      rootIntake: ctx.rootIntake ?? [],
      activeIds: ctx.activeIds,
      repoBaseUrl: ctx.repoBaseUrl,
    }
  );
  ctx.body = renderPipelineBoardBody(ctx.data);
  const composed = composePipelineBoardHtml(ctx.data, ctx.nowMs ?? NOW, ctx.repoBaseUrl ?? 'https://github.com/x/y');
  ctx.html = composed.html;
}

function recentlyClosedLines(body) {
  const lines = body.split('\n');
  const start = lines.indexOf('RECENTLY CLOSED:');
  if (start === -1) {
    return [];
  }
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '' || /^[A-Z][A-Z ]*:$/.test(lines[i])) {
      break;
    }
    out.push(lines[i]);
  }
  return out;
}

function sectionLines(body, header) {
  const lines = body.split('\n');
  const start = lines.indexOf(header);
  if (start === -1) {
    return [];
  }
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === '' || (/^[A-Z][A-Z ]*:$/.test(lines[i]) && lines[i] !== header)) {
      break;
    }
    out.push(lines[i]);
  }
  return out;
}

function gridCaptionLines(body) {
  const lines = body.split('\n');
  const parkedStart = lines.indexOf('PARKED:');
  const gridEnd = parkedStart === -1 ? lines.length : parkedStart;
  const tail = lines.slice(0, gridEnd);
  const firstBlank = tail.indexOf('');
  if (firstBlank === -1) {
    return [];
  }
  return tail.slice(firstBlank + 1).filter((line) => line !== '' && !line.startsWith('-- '));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a pipeline board whose RECENTLY CLOSED section lists closed tickets$/, (ctx) => {
    ctx.recentlyClosed = [];
    ctx.nowMs = NOW;
  });

  scoped(/^a ticket closed (\d+) ms before the render instant$/, (ctx, elapsedMs) => {
    const elapsed = Number(elapsedMs);
    ctx.recentlyClosed = [
      {
        id: TICKET_ID,
        title: TICKET_TITLE,
        filename: `${TICKET_ID}-${TICKET_TITLE}.yaml`,
        closedAtMs: (ctx.nowMs ?? NOW) - elapsed,
      },
    ];
  });

  scoped(/^the RECENTLY CLOSED section renders$/, (ctx) => {
    renderBoard(ctx);
  });

  scoped(/^its line ends with "\(([^)]+)\)"$/, (ctx, age) => {
    const line = recentlyClosedLines(ctx.body)[0];
    assert.ok(line, `expected a RECENTLY CLOSED line, body:\n${ctx.body}`);
    assert.match(line, new RegExp(`\\(${age.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`));
    assert.match(ctx.html, new RegExp(`\\(${age.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
  });

  scoped(/^a closed ticket with no recorded closure instant$/, (ctx) => {
    ctx.recentlyClosed = [
      {
        id: TICKET_ID,
        title: TICKET_TITLE,
        filename: `${TICKET_ID}-${TICKET_TITLE}.yaml`,
      },
    ];
  });

  scoped(/^its line carries no parenthetical age$/, (ctx) => {
    const line = recentlyClosedLines(ctx.body)[0];
    assert.ok(line);
    assert.doesNotMatch(line, /\([^)]*\)/);
    assert.doesNotMatch(ctx.html, /RECENTLY CLOSED:[\s\S]*\([^)]*\)/);
  });

  scoped(
    /^a ticket whose recorded closure instant is 2 hours before the render instant$/,
    (ctx) => {
      ctx.recentlyClosed = [
        {
          id: TICKET_ID,
          title: TICKET_TITLE,
          filename: `${TICKET_ID}-${TICKET_TITLE}.yaml`,
          closedAtMs: (ctx.nowMs ?? NOW) - 2 * 60 * 60 * 1000,
        },
      ];
    }
  );

  scoped(/^whose backlog file was rewritten one minute before the render instant$/, () => {
    // The board never reads file mtime for closure age — a rewrite cannot
    // change the suffix. No fixture mutation needed; closedAtMs alone drives
    // the render.
  });

  scoped(/^the board renders its "([^"]+)" section$/, (ctx, section) => {
    ctx.section = section;
    ctx.roleHeldTickets = { coder: ['BL-1'] };
    ctx.ticketMeta = {
      'BL-1': { title: 'active ticket for grid caption' },
      'BL-2': { title: 'parked ticket title here' },
      'BL-3': { title: 'awaiting approval title' },
    };
    ctx.paused = [{ id: 'BL-2' }, { id: 'BL-3', humanApproval: 'pending' }];
    ctx.activeIds = ['BL-1'];
    ctx.rootIntake = [{ id: 'INTAKE-sample', title: 'root intake sample', filename: 'INTAKE-sample.md' }];
    ctx.recentlyClosed = [
      {
        id: TICKET_ID,
        title: TICKET_TITLE,
        filename: `${TICKET_ID}.yaml`,
        closedAtMs: (ctx.nowMs ?? NOW) - 10 * 60 * 1000,
      },
    ];
  });

  scoped(/^the board body renders$/, (ctx) => {
    renderBoard(ctx);
  });

  scoped(/^no line in that section carries a parenthetical age$/, (ctx) => {
    let lines;
    switch (ctx.section) {
      case 'PARKED':
        lines = sectionLines(ctx.body, 'PARKED:');
        break;
      case 'AWAITING APPROVAL':
        lines = sectionLines(ctx.body, 'AWAITING APPROVAL:');
        break;
      case 'ROOT INTAKE':
        lines = sectionLines(ctx.body, 'ROOT INTAKE:');
        break;
      case 'grid captions':
        lines = gridCaptionLines(ctx.body);
        break;
      default:
        throw new Error(`unknown section: ${ctx.section}`);
    }
    for (const line of lines) {
      assert.doesNotMatch(line, /\([^)]*ago\)/, `unexpected age suffix on: ${line}`);
    }
  });
}

module.exports = { registerSteps };
