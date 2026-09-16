const assert = require('node:assert/strict');
const {
  SCORED_ROLES,
  parseRoleMatrixLine,
  buildScoringReportRows,
  renderScoringReportMarkdown,
  renderScoringReport,
  renderAndSendReport,
  parseArgs,
} = require('../out/tools/render-model-scoring-report');

test('parseRoleMatrixLine splits provider/model, score, and evidence', () => {
  const parsed = parseRoleMatrixLine('anthropic/claude-sonnet-5 0.92 evidence/report.json');
  assert.deepEqual(parsed, {
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    score: '0.92',
    evidence: 'evidence/report.json',
  });
});

test('parseRoleMatrixLine keeps multi-word evidence intact', () => {
  const parsed = parseRoleMatrixLine('openai/gpt-5.3-codex 0.5 no scorecard on file');
  assert.equal(parsed.evidence, 'no scorecard on file');
});

test('parseRoleMatrixLine returns null for an unrecognized shape', () => {
  assert.equal(parseRoleMatrixLine('not a role-matrix line'), null);
});

function fixtureDeps(overrides = {}) {
  const lines = {
    coder: ['anthropic/claude-sonnet-5 0.9 ev1', 'cerebras/llama-3.3-70b 0.4 ev2'],
  };
  const registry = [
    { provider: 'anthropic', model: 'claude-sonnet-5', status: 'certified', cost_class: 'medium' },
    { provider: 'cerebras', model: 'llama-3.3-70b', status: 'candidate', cost_class: 'low' },
  ];
  return {
    roles: ['coder'],
    runRoleMatrix: overrides.runRoleMatrix ?? ((role) => lines[role] ?? []),
    readRegistry: overrides.readRegistry ?? (() => registry),
  };
}

test('buildScoringReportRows produces one row per steward line, per scored role', () => {
  const rows = buildScoringReportRows(fixtureDeps());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].role, 'coder');
  assert.equal(rows[0].provider, 'anthropic');
  assert.equal(rows[0].model, 'claude-sonnet-5');
});

test('buildScoringReportRows marks certified rows and leaves candidates unmarked', () => {
  const rows = buildScoringReportRows(fixtureDeps());
  const certifiedRow = rows.find((r) => r.model === 'claude-sonnet-5');
  const candidateRow = rows.find((r) => r.model === 'llama-3.3-70b');
  assert.equal(certifiedRow.certified, true);
  assert.equal(candidateRow.certified, false);
});

test('renderScoringReportMarkdown marks certified models with * and candidates without', () => {
  const rows = buildScoringReportRows(fixtureDeps());
  const markdown = renderScoringReportMarkdown(rows);
  assert.match(markdown, /\*anthropic\/claude-sonnet-5/);
  assert.doesNotMatch(markdown, /\*cerebras\/llama-3\.3-70b/);
  assert.match(markdown, /cerebras\/llama-3\.3-70b/);
});

test('renderScoringReportMarkdown carries role, model, score and evidence per row', () => {
  const rows = buildScoringReportRows(fixtureDeps());
  const markdown = renderScoringReportMarkdown(rows);
  assert.match(markdown, /coder \| \*anthropic\/claude-sonnet-5 \| 0\.9 \| medium \| ev1/);
});

test('renderScoringReportMarkdown footer states the steward does not track the coordinator', () => {
  const rows = buildScoringReportRows(fixtureDeps());
  const markdown = renderScoringReportMarkdown(rows);
  assert.match(markdown, /does not track the coordinator as a role-matrix role/);
});

test('renderScoringReportMarkdown emits no row for the coordinator role', () => {
  const rows = buildScoringReportRows(fixtureDeps());
  assert.ok(!rows.some((r) => r.role.toLowerCase() === 'coordinator'));
});

test('SCORED_ROLES excludes the coordinator and names the seven steward roles', () => {
  assert.equal(SCORED_ROLES.includes('coordinator'), false);
  assert.deepEqual(SCORED_ROLES, ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA']);
});

test('renderScoringReport re-pulls at render time: a changed score shows in a second render', () => {
  let score = '0.4';
  const deps = {
    roles: ['coder'],
    runRoleMatrix: () => [`cerebras/llama-3.3-70b ${score} ev`],
    readRegistry: () => [{ provider: 'cerebras', model: 'llama-3.3-70b', status: 'candidate', cost_class: 'low' }],
  };
  const first = renderScoringReport(deps);
  assert.match(first, /0\.4/);
  score = '0.8';
  const second = renderScoringReport(deps);
  assert.match(second, /0\.8/);
  assert.doesNotMatch(second, /0\.4/);
});

test('parseArgs parses project root, --out, and --no-send', () => {
  assert.deepEqual(parseArgs(['/repo']), { projectRoot: '/repo', send: true });
  assert.deepEqual(parseArgs(['/repo', '--no-send']), { projectRoot: '/repo', send: false });
  assert.deepEqual(parseArgs(['/repo', '--out', '/tmp/x.md']), { projectRoot: '/repo', outPath: '/tmp/x.md', send: true });
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['/repo', '--out']), null);
});

test('renderAndSendReport writes the file and calls the injected send function exactly once', async () => {
  const written = {};
  let sendCalls = 0;
  const outcome = await renderAndSendReport(
    '/fake-root',
    { outPath: '/fake-root/tmp/report.md', send: true },
    {
      runRoleMatrix: () => ['anthropic/claude-sonnet-5 0.9 ev1'],
      readRegistry: () => [{ provider: 'anthropic', model: 'claude-sonnet-5', status: 'certified', cost_class: 'medium' }],
      writeFile: (filePath, content) => {
        written.filePath = filePath;
        written.content = content;
      },
      sendReportDocument: async () => {
        sendCalls += 1;
        return { success: true };
      },
    }
  );
  assert.equal(written.filePath, '/fake-root/tmp/report.md');
  assert.match(written.content, /\*anthropic\/claude-sonnet-5/);
  assert.equal(sendCalls, 1);
  assert.equal(outcome.sent, true);
});

test('renderAndSendReport with send:false writes the file and never calls send', async () => {
  let sendCalls = 0;
  const outcome = await renderAndSendReport(
    '/fake-root',
    { outPath: '/fake-root/tmp/report.md', send: false },
    {
      runRoleMatrix: () => [],
      readRegistry: () => [],
      writeFile: () => {},
      sendReportDocument: async () => {
        sendCalls += 1;
        return { success: true };
      },
    }
  );
  assert.equal(sendCalls, 0);
  assert.equal(outcome.sent, false);
});
