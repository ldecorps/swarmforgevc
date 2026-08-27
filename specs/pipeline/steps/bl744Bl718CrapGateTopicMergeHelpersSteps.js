'use strict';

// BL-744: CRAP gate + branch coverage for BL-718 topic merge helpers.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const CRAP_SCRIPT = path.join(EXT_DIR, 'scripts', 'crapReport.js');
const CRAP_SOURCES = [
  'src/bridge/bubbleMirrorTopic.ts',
  'src/bridge/bubbleMirrorState.ts',
  'src/bridge/bridgeServer.ts',
  'src/tools/telegramCursorBridgeCore.ts',
];

const FEATURE = 'BL-718 topic merge helpers meet the CRAP gate with real branch coverage';
const CRAP_TARGETS = [
  'mergeTopicId',
  'readCursorBridgeTopicIds',
  'mirrorLetsTalkTurnToBubble',
  'mirrorLetsTalkChoicePollToBubble',
  'appendPendingChoicePoll',
  'buildPersistedState',
];

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function runVitest(testFiles) {
  const result = spawnSync(
    'npx',
    ['vitest', 'run', ...testFiles, '--coverage'],
    { cwd: EXT_DIR, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(result.stdout || result.stderr || 'vitest failed');
  }
}

function parseCrapRows(output) {
  const rows = new Map();
  for (const line of output.split('\n')) {
    const match = line.match(/\t([^\t]+)\tcomplexity=\d+\tcoverage=\d+%\tCRAP=([\d.]+)/);
    if (!match) continue;
    rows.set(match[1], Number(match[2]));
  }
  return rows;
}

function runScopedCrapReport() {
  const args = CRAP_SOURCES.map((rel) => path.join(EXT_DIR, rel));
  const result = spawnSync(process.execPath, [CRAP_SCRIPT, ...args], {
    cwd: EXT_DIR,
    encoding: 'utf8',
  });
  if (!result.stdout) {
    throw new Error(result.stderr || 'crapReport produced no stdout');
  }
  return result.stdout;
}

function assertCrapAtMost(ctx, fnName, max) {
  const score = ctx.crapRows.get(fnName);
  if (score === undefined) {
    throw new Error(`CRAP report missing function ${fnName}`);
  }
  if (score > max) {
    throw new Error(`${fnName} CRAP=${score.toFixed(2)} exceeds ${max}`);
  }
}

function registerSteps(registry) {
  scoped(registry, /^the BL-744 topic merge helper acceptance scope$/, () => {});

  scoped(registry, /^the BL-744 topic merge helper unit tests run$/, () => {
    runVitest(['test/bl744TopicMergeHelpers.test.js']);
  });

  scoped(registry, /^every BL-744 topic merge helper unit test passes$/, () => {});

  scoped(registry, /^the BL-718 letsTalkBridge regression tests run$/, () => {
    runVitest(['test/letsTalkBridge.test.js']);
  });

  scoped(registry, /^every BL-718 letsTalkBridge regression test passes$/, () => {});

  scoped(registry, /^a scoped CRAP report runs for the BL-744 targets$/, (ctx) => {
    runVitest(['test/bl744TopicMergeHelpers.test.js', 'test/letsTalkBridge.test.js']);
    const output = runScopedCrapReport();
    ctx.crapRows = parseCrapRows(output);
    for (const fnName of CRAP_TARGETS) {
      if (!ctx.crapRows.has(fnName)) {
        throw new Error(`CRAP report missing BL-744 target ${fnName}`);
      }
    }
  });

  scoped(registry, /^mergeTopicId reports CRAP at most (\d+)$/, (ctx, max) => {
    assertCrapAtMost(ctx, 'mergeTopicId', Number(max));
  });

  scoped(registry, /^readCursorBridgeTopicIds reports CRAP at most (\d+)$/, (ctx, max) => {
    assertCrapAtMost(ctx, 'readCursorBridgeTopicIds', Number(max));
  });

  scoped(registry, /^mirrorLetsTalkTurnToBubble reports CRAP at most (\d+)$/, (ctx, max) => {
    assertCrapAtMost(ctx, 'mirrorLetsTalkTurnToBubble', Number(max));
  });

  scoped(registry, /^mirrorLetsTalkChoicePollToBubble reports CRAP at most (\d+)$/, (ctx, max) => {
    assertCrapAtMost(ctx, 'mirrorLetsTalkChoicePollToBubble', Number(max));
  });

  scoped(registry, /^appendPendingChoicePoll reports CRAP at most (\d+)$/, (ctx, max) => {
    assertCrapAtMost(ctx, 'appendPendingChoicePoll', Number(max));
  });

  scoped(registry, /^buildPersistedState reports CRAP at most (\d+)$/, (ctx, max) => {
    assertCrapAtMost(ctx, 'buildPersistedState', Number(max));
  });
}

module.exports = { registerSteps };
