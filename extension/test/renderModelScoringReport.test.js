const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
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

test('buildScoringReportRows silently drops a line parseRoleMatrixLine rejects (never fabricates a row)', () => {
  const rows = buildScoringReportRows({
    roles: ['coder'],
    runRoleMatrix: () => ['not a role-matrix line', 'anthropic/claude-sonnet-5 0.9 ev1'],
    readRegistry: () => [],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].model, 'claude-sonnet-5');
});

test('buildScoringReportRows leaves plan empty and certified false for a line whose provider/model has no registry entry at all', () => {
  const rows = buildScoringReportRows({
    roles: ['coder'],
    runRoleMatrix: () => ['nvidia/nemotron-3-ultra-550b-a55b 0.6 ev'],
    readRegistry: () => [],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].plan, '');
  assert.equal(rows[0].certified, false);
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

test('renderAndSendReport with send:true carries the send function\'s reason forward when it fails', async () => {
  const outcome = await renderAndSendReport(
    '/fake-root',
    { outPath: '/fake-root/tmp/report.md', send: true },
    {
      runRoleMatrix: () => [],
      readRegistry: () => [],
      writeFile: () => {},
      sendReportDocument: async () => ({ success: false, reason: 'operator-topic-not-yet-created' }),
    }
  );
  assert.equal(outcome.sent, false);
  assert.equal(outcome.reason, 'operator-topic-not-yet-created');
});

// The two tests below exercise the REAL readRegistry/writeFile adapters
// (no deps override for either) - the only way to reach realReadRegistry's
// own existsSync branch and the default writeFile closure's real
// mkdirSync+writeFileSync, both otherwise 0% covered because every other
// test injects a fake in their place (CRAP scoping rule, engineering
// article: a real IO adapter needs its own test, not just its callers').
test('renderAndSendReport reads a real registry.json from the project root and writes a real file when no readRegistry/writeFile deps are given', async () => {
  const root = mkTmpDir('sfvc-bl1510-render-real-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'model-steward'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'model-steward', 'registry.json'),
    JSON.stringify({
      models: {
        'anthropic/claude-sonnet-5': { provider: 'anthropic', model: 'claude-sonnet-5', status: 'certified', cost_class: 'medium' },
      },
    })
  );
  const outPath = path.join(root, 'tmp', 'model-scoring-report.md');
  const outcome = await renderAndSendReport(root, { outPath, send: false }, { runRoleMatrix: () => ['anthropic/claude-sonnet-5 0.9 ev1'] });
  assert.equal(outcome.sent, false);
  const written = fs.readFileSync(outPath, 'utf8');
  assert.match(written, /\*anthropic\/claude-sonnet-5/);
});

test('renderAndSendReport falls back to an empty registry (no certified marks) when the project root has no registry.json', async () => {
  const root = mkTmpDir('sfvc-bl1510-render-noregistry-');
  const outPath = path.join(root, 'tmp', 'model-scoring-report.md');
  await renderAndSendReport(root, { outPath, send: false }, { runRoleMatrix: () => ['anthropic/claude-sonnet-5 0.9 ev1'] });
  const written = fs.readFileSync(outPath, 'utf8');
  assert.match(written, /anthropic\/claude-sonnet-5/);
  assert.doesNotMatch(written, /\*anthropic\/claude-sonnet-5/);
});

// realSendReportDocument's own branches, reached the same way (no
// sendReportDocument override) - topic-not-found, missing config, and both
// forced outcomes via TELEGRAM_NOTIFY_FORCE_RESULT, the established
// no-network test seam send-telegram-document.ts's own sendAnnouncement
// uses (BL-1509).
function withEnv(overrides, fn) {
  const keys = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_NOTIFY_FORCE_RESULT'];
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    if (overrides[k] === undefined) delete process.env[k];
    else process.env[k] = overrides[k];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of keys) {
        if (previous[k] === undefined) delete process.env[k];
        else process.env[k] = previous[k];
      }
    });
}

test('renderAndSendReport with send:true and no sendReportDocument override reports operator-topic-not-yet-created when the topic map has no operator topic', async () => {
  const root = mkTmpDir('sfvc-bl1510-real-send-no-topic-');
  const outPath = path.join(root, 'tmp', 'model-scoring-report.md');
  await withEnv({ TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: 'chat' }, async () => {
    const outcome = await renderAndSendReport(root, { outPath, send: true }, { runRoleMatrix: () => [], readRegistry: () => [] });
    assert.equal(outcome.sent, false);
    assert.equal(outcome.reason, 'operator-topic-not-yet-created');
  });
});

test('renderAndSendReport with send:true and no sendReportDocument override reports missing-telegram-config when the token/chat env vars are absent', async () => {
  const root = mkTmpDir('sfvc-bl1510-real-send-no-config-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json'), JSON.stringify({ 777: 'OPERATOR' }));
  const outPath = path.join(root, 'tmp', 'model-scoring-report.md');
  await withEnv({}, async () => {
    const outcome = await renderAndSendReport(root, { outPath, send: true }, { runRoleMatrix: () => [], readRegistry: () => [] });
    assert.equal(outcome.sent, false);
    assert.equal(outcome.reason, 'missing-telegram-config');
  });
});

test('renderAndSendReport with send:true and no sendReportDocument override honours a forced success result with no real network call', async () => {
  const root = mkTmpDir('sfvc-bl1510-real-send-forced-ok-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json'), JSON.stringify({ 777: 'OPERATOR' }));
  const outPath = path.join(root, 'tmp', 'model-scoring-report.md');
  await withEnv(
    { TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: 'chat', TELEGRAM_NOTIFY_FORCE_RESULT: JSON.stringify({ success: true }) },
    async () => {
      const outcome = await renderAndSendReport(root, { outPath, send: true }, { runRoleMatrix: () => [], readRegistry: () => [] });
      assert.equal(outcome.sent, true);
    }
  );
});

test('renderAndSendReport with send:true and no sendReportDocument override carries a forced failure result\'s reason forward', async () => {
  const root = mkTmpDir('sfvc-bl1510-real-send-forced-fail-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json'), JSON.stringify({ 777: 'OPERATOR' }));
  const outPath = path.join(root, 'tmp', 'model-scoring-report.md');
  await withEnv(
    { TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: 'chat', TELEGRAM_NOTIFY_FORCE_RESULT: JSON.stringify({ success: false, error: 'telegram-down' }) },
    async () => {
      const outcome = await renderAndSendReport(root, { outPath, send: true }, { runRoleMatrix: () => [], readRegistry: () => [] });
      assert.equal(outcome.sent, false);
      assert.equal(outcome.reason, 'telegram-down');
    }
  );
});

// ── main() at the CLI/argv boundary ─────────────────────────────────────
// Covers exports.main's own body (the makeArgsGuardedMain callback), which
// nothing above reaches - every other test drives renderAndSendReport
// directly. In-process (stubbed argv/env), never a subprocess, per the
// CLI thin-wrapper convention (engineering article) - and never a real bb
// role-matrix pull against this repo's own state: the fixture root gets
// its own trivial stub at swarmforge/scripts/model_steward_cli.bb so the
// real steward's (large, stateful) CLI is never invoked from a test.
function mkMainFixtureRoot() {
  const root = mkTmpDir('sfvc-bl1510-main-');
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'scripts', 'model_steward_cli.bb'),
    '(println "anthropic/claude-sonnet-5 0.9 evidence/x.json")\n'
  );
  return root;
}

const MAIN_ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_NOTIFY_FORCE_RESULT'];
async function runMainInProcess(argv, envOverrides = {}) {
  const { main } = require('../out/tools/render-model-scoring-report');
  const originalArgv = process.argv;
  const previousEnv = Object.fromEntries(MAIN_ENV_KEYS.map((k) => [k, process.env[k]]));
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    for (const k of MAIN_ENV_KEYS) {
      if (envOverrides[k] === undefined) delete process.env[k];
      else process.env[k] = envOverrides[k];
    }
    process.argv = ['node', 'render-model-scoring-report.js', ...argv];
    await main();
    return { exitCode: process.exitCode, stdout: writes.join('') };
  } finally {
    process.stdout.write = originalWrite;
    process.argv = originalArgv;
    process.exitCode = previousExitCode;
    for (const k of MAIN_ENV_KEYS) {
      if (previousEnv[k] === undefined) delete process.env[k];
      else process.env[k] = previousEnv[k];
    }
  }
}

test('main() with --no-send writes the file, prints sent:false, and leaves exitCode unset', async () => {
  const root = mkMainFixtureRoot();
  const { exitCode, stdout } = await runMainInProcess([root, '--no-send'], {});
  assert.equal(exitCode, undefined);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.sent, false);
  assert.ok(fs.existsSync(parsed.outPath));
});

test('main() with send requested and a forced successful delivery leaves exitCode unset', async () => {
  const root = mkMainFixtureRoot();
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json'), JSON.stringify({ 777: 'OPERATOR' }));
  const { exitCode, stdout } = await runMainInProcess([root], {
    TELEGRAM_BOT_TOKEN: 'tok',
    TELEGRAM_CHAT_ID: 'chat',
    TELEGRAM_NOTIFY_FORCE_RESULT: JSON.stringify({ success: true }),
  });
  assert.equal(exitCode, undefined);
  assert.equal(JSON.parse(stdout).sent, true);
});

test('main() with send requested but no delivery possible sets exitCode 1', async () => {
  const root = mkMainFixtureRoot();
  const { exitCode, stdout } = await runMainInProcess([root], {});
  assert.equal(exitCode, 1);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.sent, false);
  assert.equal(parsed.reason, 'operator-topic-not-yet-created');
});
