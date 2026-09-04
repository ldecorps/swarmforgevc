'use strict';

// BL-726: meta acceptance for BL-718 step-handler wiring. Exercises the real
// pipeline CLI and inspects the committed bl718BubbleTalkMirrorSteps module.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'specs', 'pipeline', 'cli.js');
const STEPS_INDEX = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'index.js');
const BL718_HANDLER = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'bl718BubbleTalkMirrorSteps.js');
const BL718_FEATURE = path.join(
  REPO_ROOT,
  'specs',
  'features',
  'BL-718-bubble-talk-mirror-chunks-and-fails-loudly.feature'
);

const FEATURE = 'BL-718 acceptance feature runs with real step handlers';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function runBl718FeatureCli() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [CLI, BL718_FEATURE], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
  });
  return { status: result.status ?? 1, output: `${result.stdout || ''}${result.stderr || ''}` };
}

async function runBl718ScenarioByName(name) {
  const { parseFeatureFile } = require('../runnerAdapter');
  const { createStepRegistry } = require('../stepRegistry');
  const { registerSteps } = require('./index');
  const { runScenario } = require('../runtime');

  const feature = parseFeatureFile(BL718_FEATURE);
  const scenario = feature.scenarios.find((s) => s.name === name);
  if (!scenario) {
    throw new Error(`BL-718 scenario not found: "${name}"`);
  }
  const registry = createStepRegistry();
  registerSteps(registry);
  if (scenario.examples && scenario.examples.length > 0) {
    for (const row of scenario.examples) {
      await runScenario(registry, feature, scenario, row);
    }
    return;
  }
  await runScenario(registry, feature, scenario);
}

function registerSteps(registry) {
  scoped(registry, /^the BL-718 acceptance feature file exists under specs\/features$/, () => {
    if (!fs.existsSync(BL718_FEATURE)) {
      throw new Error(`missing BL-718 feature file at ${BL718_FEATURE}`);
    }
  });

  scoped(registry, /^the BL-718 acceptance feature is executed through the pipeline CLI$/, (ctx) => {
    ctx.bl726Cli = runBl718FeatureCli();
  });

  scoped(registry, /^no scenario fails with no step handler matched$/, (ctx) => {
    const out = ctx.bl726Cli?.output || '';
    if (/no step handler matched/i.test(out)) {
      throw new Error(`BL-718 CLI reported unmatched steps:\n${out}`);
    }
    if (ctx.bl726Cli?.status !== 0) {
      throw new Error(`BL-718 CLI exited ${ctx.bl726Cli.status}:\n${out}`);
    }
  });

  scoped(registry, /^the BL-718 step handler module is registered in the pipeline steps index$/, () => {
    // BL-1371: registration is no longer a require line in steps/index.js -
    // the registry discovers every top-level `*Steps.js` file in the steps
    // directory. So the question this step asks is whether the handler file
    // is one the registry's own discovery returns, asked of that discovery
    // rather than of index.js's text.
    if (!fs.existsSync(BL718_HANDLER)) {
      throw new Error(`missing handler module at ${BL718_HANDLER}`);
    }
    const { stepHandlerFileNames } = require(path.join(path.dirname(STEPS_INDEX), 'discoverStepHandlers.js'));
    const discovered = stepHandlerFileNames(path.dirname(STEPS_INDEX));
    if (!discovered.includes(path.basename(BL718_HANDLER))) {
      throw new Error(`the steps registry does not discover ${path.basename(BL718_HANDLER)}`);
    }
  });

  scoped(registry, /^the handler source is inspected$/, (ctx) => {
    ctx.bl726HandlerSource = fs.readFileSync(BL718_HANDLER, 'utf8');
  });

  scoped(
    registry,
    /^it invokes the committed Bubble talk mirror or shared Telegram chunker$/,
    (ctx) => {
      const src = ctx.bl726HandlerSource || '';
      if (!/mirrorLetsTalkTurnToBubble/.test(src) || !/splitTelegramChunks/.test(src)) {
        throw new Error('BL-718 handler must require mirrorLetsTalkTurnToBubble and splitTelegramChunks');
      }
      if (!/bridgeServer|telegramCursorBridgeCore/.test(src)) {
        throw new Error('BL-718 handler must load compiled bridge/chunker modules');
      }
    }
  );

  scoped(registry, /^it does not assert against prompt text alone$/, (ctx) => {
    const src = ctx.bl726HandlerSource || '';
    if (/swarmforge\/roles\/.*\.prompt/.test(src)) {
      throw new Error('BL-718 handler must not assert against role prompt files');
    }
    if (!/processLetsTalkTurn|mirrorLetsTalkTurnToBubble/.test(src)) {
      throw new Error('BL-718 handler must drive real mirror/turn entry points');
    }
  });

  scoped(registry, /^the BL-718 scenario (.+) is executed through the pipeline CLI$/, async (_ctx, scenarioName) => {
    await runBl718ScenarioByName(scenarioName);
  });

  scoped(registry, /^that scenario passes$/, () => {
    // runBl718ScenarioByName throws on failure.
  });

  scoped(registry, /^node specs\/pipeline\/cli\.js runs the BL-718 bubble talk mirror feature$/, (ctx) => {
    ctx.bl726Cli = runBl718FeatureCli();
  });

  scoped(registry, /^every scenario passes$/, (ctx) => {
    const out = ctx.bl726Cli?.output || '';
    if (/✖|not ok|failed at step/i.test(out)) {
      throw new Error(`BL-718 feature had failing scenarios:\n${out}`);
    }
  });

  scoped(registry, /^the run exits successfully$/, (ctx) => {
    if (ctx.bl726Cli?.status !== 0) {
      throw new Error(`expected CLI exit 0, got ${ctx.bl726Cli.status}:\n${ctx.bl726Cli.output}`);
    }
  });
}

module.exports = { registerSteps };
