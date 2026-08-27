'use strict';

// BL-740: CRAP gate + fixture coverage for collectReferencedClaudeModels.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const CRAP_SCRIPT = path.join(EXT_DIR, 'scripts', 'crapReport.js');
const PRICING_TABLE_SRC = path.join(EXT_DIR, 'src', 'metrics', 'pricingTable.ts');

const FEATURE =
  'collectReferencedClaudeModels meets the CRAP gate with fixture-driven coverage';
const CRAP_TARGETS = ['collectReferencedClaudeModels', 'addClaudeModelsFromDir'];

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
  const result = spawnSync(process.execPath, [CRAP_SCRIPT, PRICING_TABLE_SRC], {
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
  scoped(registry, /^the BL-740 pricing table acceptance scope$/, () => {});

  scoped(registry, /^the BL-740 pricing table unit tests run$/, () => {
    runVitest(['test/pricingTable.test.js', '-t', 'BL-740']);
  });

  scoped(registry, /^every BL-740 pricing table unit test passes$/, () => {});

  scoped(registry, /^the BL-627 pricingTable regression tests run$/, () => {
    runVitest(['test/pricingTable.test.js']);
  });

  scoped(registry, /^every BL-627 pricingTable regression test passes$/, () => {});

  scoped(registry, /^a scoped CRAP report runs for pricingTable\.ts$/, (ctx) => {
    runVitest(['test/pricingTable.test.js']);
    ctx.crapRows = parseCrapRows(runScopedCrapReport());
    for (const fnName of CRAP_TARGETS) {
      if (!ctx.crapRows.has(fnName)) {
        throw new Error(`CRAP report missing BL-740 target ${fnName}`);
      }
    }
  });

  scoped(registry, /^collectReferencedClaudeModels reports CRAP at most (\d+)$/, (ctx, max) => {
    assertCrapAtMost(ctx, 'collectReferencedClaudeModels', Number(max));
  });

  scoped(registry, /^addClaudeModelsFromDir reports CRAP at most (\d+)$/, (ctx, max) => {
    assertCrapAtMost(ctx, 'addClaudeModelsFromDir', Number(max));
  });
}

module.exports = { registerSteps };
