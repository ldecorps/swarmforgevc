'use strict';

// BL-1822: step handlers for "the morning briefing carries the recruiter's
// model scout table". Drives the REAL
// `bb recruiter_score_table_cli.bb <root> --briefing --today <date>` over a
// disposable mkdtemp fixture (a fixture score-table.json and fixture
// docs/briefings/*.md files) - never a reimplementation of its own
// rendering/date logic.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'recruiter_score_table_cli.bb');

const FEATURE = "BL-1822 The morning briefing carries the recruiter's model scout table";

const TODAY = '2026-10-01';
const PREVIOUS_BRIEFING = '2026-09-30';

function ensureState(ctx) {
  if (!ctx.bl1822) {
    ctx.bl1822 = { root: mkSocketFixtureRoot('bl1822-model-scout-') };
    fs.mkdirSync(path.join(ctx.bl1822.root, '.swarmforge', 'recruiter'), { recursive: true });
    fs.mkdirSync(path.join(ctx.bl1822.root, 'docs', 'briefings'), { recursive: true });
  }
  return ctx.bl1822;
}

function writeTable(root, { updatedAt, rows, recommend }) {
  const table = { rows, recommend: { specifier: recommend }, updated_at: updatedAt };
  fs.writeFileSync(path.join(root, '.swarmforge', 'recruiter', 'score-table.json'), JSON.stringify(table));
}

function writePreviousBriefing(root, date) {
  fs.writeFileSync(path.join(root, 'docs', 'briefings', `${date}.md`), '# briefing\n');
}

function runCli(ctx) {
  const st = ensureState(ctx);
  const result = spawnSync('bb', [CLI, st.root, '--briefing', '--today', TODAY], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`recruiter_score_table_cli.bb failed (exit ${result.status}): ${result.stderr}`);
  }
  st.output = result.stdout.replace(/\n$/, '');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a score table with 3 specifier rows updated after the previous briefing$/, (ctx) => {
    const st = ensureState(ctx);
    writePreviousBriefing(st.root, PREVIOUS_BRIEFING);
    writeTable(st.root, {
      updatedAt: '20261001T000000Z',
      rows: [
        { model: 'model-a', hf_id: 'org/model-a', incumbent: false, passed: 3, total: 5 },
        { model: 'model-b', hf_id: 'org/model-b', incumbent: true, passed: 5, total: 5 },
        { model: 'model-c', hf_id: 'org/model-c', incumbent: false, passed: 1, total: 5 },
      ],
      recommend: 'keep the incumbent model-b (5/5)',
    });
  });

  scoped(/^the score table was last updated before the previous briefing$/, (ctx) => {
    const st = ensureState(ctx);
    writePreviousBriefing(st.root, PREVIOUS_BRIEFING);
    writeTable(st.root, {
      updatedAt: '20260929T000000Z',
      rows: [{ model: 'model-a', hf_id: 'org/model-a', incumbent: false, passed: 3, total: 5 }],
      recommend: 'keep the incumbent model-a (3/5)',
    });
  });

  scoped(/^no score table exists$/, (ctx) => {
    ensureState(ctx);
    // No-op beyond Background's fixture setup: score-table.json is simply
    // never written.
  });

  scoped(/^the Model scout section is rendered$/, (ctx) => {
    runCli(ctx);
  });

  scoped(
    /^it lists the 3 rows by passed count, highest first, each naming the model, its passed count out of the total and whether it is the incumbent$/,
    (ctx) => {
      const st = ensureState(ctx);
      const expectedRows = ['- **model-b** — 5/5 (incumbent)', '- **model-a** — 3/5', '- **model-c** — 1/5'];
      for (const line of expectedRows) {
        if (!st.output.includes(line)) {
          throw new Error(`expected output to include "${line}"; got:\n${st.output}`);
        }
      }
      const order = expectedRows.map((l) => st.output.indexOf(l));
      for (let i = 1; i < order.length; i += 1) {
        if (order[i] <= order[i - 1]) {
          throw new Error(`rows are not in best-first order; got:\n${st.output}`);
        }
      }
    }
  );

  scoped(/^it ends with the table's recommend line$/, (ctx) => {
    const st = ensureState(ctx);
    const lastLine = st.output.trim().split('\n').pop();
    if (lastLine !== 'Recommend: keep the incumbent model-b (5/5)') {
      throw new Error(`expected the last line to be the table's recommend line; got: "${lastLine}"`);
    }
  });

  scoped(/^the section is the single line "([^"]+)"$/, (ctx, expectedLine) => {
    const st = ensureState(ctx);
    if (st.output !== expectedLine) {
      throw new Error(`expected the single line "${expectedLine}"; got:\n${st.output}`);
    }
  });
}

module.exports = { registerSteps };
