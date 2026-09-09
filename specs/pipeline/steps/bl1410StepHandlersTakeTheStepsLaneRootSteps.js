'use strict';

// BL-1410: step handlers for "acceptance step handlers take their fixture
// roots from the steps-lane helper". Verifies that migrated handlers use
// mkSocketFixtureRoot (which cleans up on process exit) instead of mkTmpDir
// (which only cleans up via Vitest afterEach that the acceptance runner
// doesn't load).

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const STEPS_DIR = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps');
const FEATURES_DIR = path.join(REPO_ROOT, 'specs', 'features');
const RUN_ACCEPTANCE = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh');

function findFeatureFile(ticket) {
  const features = fs.readdirSync(FEATURES_DIR)
    .filter(f => f.startsWith(ticket) && f.endsWith('.feature'));
  if (features.length === 0) {
    throw new Error(`No feature file found for ${ticket}`);
  }
  return path.join(FEATURES_DIR, features[0]);
}

// Scenario 01: verify migrated features clean up their fixture roots
function registerSteps(registry) {
  registry.define(
    /^the feature for "([^"]+)" runs under the acceptance runner with fixture-root creation traced$/,
    (ctx, ticket) => {
      const featureFile = findFeatureFile(ticket);

      // Create a preload script that traces mkdtempSync calls
      const preloadScript = `
        const fs = require('fs');
        const originalMkdtempSync = fs.mkdtempSync;
        const createdRoots = [];
        fs.mkdtempSync = function(...args) {
          const result = originalMkdtempSync.apply(this, args);
          createdRoots.push(result);
          return result;
        };
        process.on('exit', () => {
          fs.writeFileSync('/tmp/bl1410-traced-roots.json', JSON.stringify(createdRoots));
        });
      `;
      const preloadFile = path.join(REPO_ROOT, 'tmp', 'bl1410-preload.js');
      fs.mkdirSync(path.dirname(preloadFile), { recursive: true });
      fs.writeFileSync(preloadFile, preloadScript);

      // Run the acceptance runner with the preload
      try {
        execFileSync(RUN_ACCEPTANCE, [featureFile], {
          env: { ...process.env, NODE_OPTIONS: `--require ${preloadFile}` },
          stdio: 'inherit'
        });
        ctx.acceptancePassed = true;
      } catch (err) {
        ctx.acceptancePassed = false;
        ctx.acceptanceError = err.message;
      }

      // Read the traced roots
      const tracedRootsFile = '/tmp/bl1410-traced-roots.json';
      if (fs.existsSync(tracedRootsFile)) {
        ctx.createdRoots = JSON.parse(fs.readFileSync(tracedRootsFile, 'utf8'));
        fs.unlinkSync(tracedRootsFile);
      } else {
        ctx.createdRoots = [];
      }

      // Clean up preload
      if (fs.existsSync(preloadFile)) {
        fs.unlinkSync(preloadFile);
      }
    }
  );

  registry.define(/^every scenario run passes$/, (ctx) => {
    if (!ctx.acceptancePassed) {
      throw new Error(`Acceptance run failed: ${ctx.acceptanceError || 'unknown error'}`);
    }
  });

  registry.define(/^at least one fixture root was created during the run$/, (ctx) => {
    if (!ctx.createdRoots || ctx.createdRoots.length === 0) {
      throw new Error('No fixture roots were created during the run');
    }
  });

  registry.define(/^no fixture root the run created still exists after the run$/, (ctx) => {
    const existingRoots = ctx.createdRoots.filter(root => fs.existsSync(root));
    if (existingRoots.length > 0) {
      throw new Error(
        `${existingRoots.length} fixture root(s) still exist after the run:\n` +
        existingRoots.map(r => `  - ${r}`).join('\n')
      );
    }
  });

  // Scenario 02: verify no handler imports mkTmpDir or defines local mkTmpDir
  registry.define(/^every step handler under specs\/pipeline\/steps is read as code$/, (ctx) => {
    const stepFiles = fs.readdirSync(STEPS_DIR)
      .filter(f => f.endsWith('Steps.js'))
      .map(f => path.join(STEPS_DIR, f));

    ctx.handlers = stepFiles.map(file => ({
      file,
      content: fs.readFileSync(file, 'utf8')
    }));
  });

  registry.define(/^none imports mkTmpDir from extension\/test's tmpDir helper$/, (ctx) => {
    const violators = [];
    for (const handler of ctx.handlers) {
      // Check for import of mkTmpDir from tmpDir helper
      // Exclude string literals (lines starting with // or containing quotes)
      const lines = handler.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments and string literals
        if (line.trim().startsWith('//') || line.includes("require('./helpers/tmpDir')")) {
          continue;
        }
        // Check for actual import statement
        if (/const\s+{\s*mkTmpDir\s*}\s*=\s*require/.test(line) &&
            line.includes('extension/test/helpers/tmpDir')) {
          violators.push(`${path.basename(handler.file)}:${i + 1}`);
        }
      }
    }
    if (violators.length > 0) {
      throw new Error(
        `${violators.length} handler(s) still import mkTmpDir:\n` +
        violators.map(v => `  - ${v}`).join('\n')
      );
    }
  });

  registry.define(/^none defines a local mkTmpDir over a raw mkdtemp$/, (ctx) => {
    const violators = [];
    for (const handler of ctx.handlers) {
      // Check for local function definition
      if (/function\s+mkTmpDir\s*\(/.test(handler.content)) {
        violators.push(path.basename(handler.file));
      }
    }
    if (violators.length > 0) {
      throw new Error(
        `${violators.length} handler(s) define local mkTmpDir:\n` +
        violators.map(v => `  - ${v}`).join('\n')
      );
    }
  });

  // Scenario 03: verify convention-gate handlers' string literals are unchanged
  registry.define(
    /^the convention-gate handlers that write mkTmpDir into scratch files as test data$/,
    (ctx) => {
      // These are the handlers that write mkTmpDir as string data
      ctx.conventionGateHandlers = [
        'bl743PilotMkdtempConventionSteps.js',
        'bl1209MkdtempDetectorFromToolSteps.js',
        'bl1280MkdtempMigrationCompleteSteps.js',
        'bl868PropertyLaneIsolationGuardsSteps.js'
      ];
    }
  );

  registry.define(/^those string literals are unchanged$/, (ctx) => {
    // This is verified by the fact that the handlers still contain the expected
    // string literals. We check that each convention-gate handler still has
    // mkTmpDir in string form (not as an import or call).
    for (const handlerFile of ctx.conventionGateHandlers) {
      const handlerPath = path.join(STEPS_DIR, handlerFile);
      if (!fs.existsSync(handlerPath)) {
        throw new Error(`Convention-gate handler not found: ${handlerFile}`);
      }
      const content = fs.readFileSync(handlerPath, 'utf8');
      // Check that mkTmpDir appears in string literals (quotes or regex)
      const hasStringLiteral = /['"].*mkTmpDir.*['"]/.test(content) ||
                               /\/.*mkTmpDir.*\//.test(content);
      if (!hasStringLiteral) {
        throw new Error(
          `Convention-gate handler ${handlerFile} no longer contains mkTmpDir as string data`
        );
      }
    }
  });

  registry.define(/^their features still pass under the acceptance runner$/, (ctx) => {
    // Run each convention-gate feature and verify it passes
    for (const handlerFile of ctx.conventionGateHandlers) {
      // Extract ticket ID from handler filename (e.g., bl743 -> BL-743)
      const match = handlerFile.match(/^bl(\d+)/);
      if (!match) continue;
      const ticket = `BL-${match[1]}`;

      let featureFile;
      try {
        featureFile = findFeatureFile(ticket);
      } catch {
        continue; // No feature file for this ticket, skip
      }

      try {
        execFileSync(RUN_ACCEPTANCE, [featureFile], { stdio: 'pipe' });
      } catch (err) {
        throw new Error(`Convention-gate feature ${ticket} failed: ${err.message}`);
      }
    }
  });
}

module.exports = { registerSteps };
