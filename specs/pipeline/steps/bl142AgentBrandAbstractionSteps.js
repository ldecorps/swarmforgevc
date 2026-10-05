'use strict';

// BL-1946 (BL-142 stamp-off): step handlers for "Extension pane-state
// detection is driven by provider descriptors". Drives the REAL compiled
// agentPaneState.js (PROVIDER_DESCRIPTORS/isAgentCliRunning/
// isAgentActivelyWorking/agentPaneStatusMessage) directly - never a
// restatement of the detection logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
let _agentPaneState = null;
function agentPaneState() {
  if (!_agentPaneState) _agentPaneState = require(path.join(EXT_DIR, 'out', 'panel', 'agentPaneState'));
  return _agentPaneState;
}

const FEATURE = 'Extension pane-state detection is driven by provider descriptors';

// A real pane command for each descriptor already shipping, so parity is
// checked against the actual registry, not a restated list.
function cliCommandFor(name) {
  return { claude: '/usr/local/bin/claude', aider: '/usr/local/bin/aider', codex: 'codex', copilot: 'copilot', grok: 'grok' }[name];
}

// Reads the TS SOURCE text of just the detection functions (never
// PROVIDER_DESCRIPTORS itself, which legitimately holds every brand name
// as data, and never the single documented DEFAULT_PROVIDER_NAME = 'claude'
// line, a default LOOKUP KEY into that same registry, not an inline brand
// check) and confirms no provider's own name string appears quoted inside
// them - the structural half of "no provider brand name is hardcoded in
// the detection functions".
function detectionFunctionsSourceHasNoBrandLiteral() {
  const srcPath = path.join(EXT_DIR, 'src', 'panel', 'agentPaneState.ts');
  const text = fs.readFileSync(srcPath, 'utf8');
  const afterDefault = text.indexOf('\n', text.indexOf('const DEFAULT_PROVIDER_NAME')) + 1;
  // Comments may legitimately discuss the pre-refactor behavior in prose
  // (e.g. a doc comment naming "Claude" to explain a default) - only
  // executable code is this check's concern.
  const detectionSource = text
    .slice(afterDefault)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  const names = agentPaneState().PROVIDER_DESCRIPTORS.map((d) => d.name);
  for (const name of names) {
    const quoted = new RegExp(`['"]${name}['"]`, 'i');
    if (quoted.test(detectionSource)) {
      return false;
    }
  }
  return true;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the supported providers are expressed as descriptors in a registry$/, (ctx) => {
    const { PROVIDER_DESCRIPTORS } = agentPaneState();
    assert.ok(Array.isArray(PROVIDER_DESCRIPTORS) && PROVIDER_DESCRIPTORS.length > 0);
    ctx.bl142 = { providerNames: PROVIDER_DESCRIPTORS.map((d) => d.name) };
  });

  scoped(/^pane state is computed for a pane running any supported provider CLI$/, (ctx) => {
    const { isAgentCliRunning } = agentPaneState();
    ctx.bl142.results = ctx.bl142.providerNames.map((name) => ({
      name,
      running: isAgentCliRunning(cliCommandFor(name), ''),
    }));
  });

  scoped(/^the result matches the pre-refactor behavior for that provider$/, (ctx) => {
    for (const { name, running } of ctx.bl142.results) {
      assert.equal(running, true, `expected ${name}'s own CLI command to be detected as running`);
    }
  });

  scoped(/^no provider brand name is hardcoded in the detection functions$/, () => {
    assert.ok(detectionFunctionsSourceHasNoBrandLiteral(), 'a provider name literal was found inside the detection functions, outside PROVIDER_DESCRIPTORS');
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(
    /^a new provider descriptor with name, cli pattern, busy pattern, banner, and startup copy is added to the registry$/,
    (ctx) => {
      const { PROVIDER_DESCRIPTORS } = agentPaneState();
      ctx.bl142 = {
        descriptor: {
          name: 'fixturetool',
          cliPattern: /(?:^|\/)fixturetool$/,
          busyPattern: /doing a fixture thing/,
          bannerPattern: /\bFixtureTool v\d/,
          startupCopy: 'FixtureTool',
        },
      };
      PROVIDER_DESCRIPTORS.push(ctx.bl142.descriptor);
    }
  );

  scoped(/^a pane runs that provider's CLI$/, (ctx) => {
    const { isAgentCliRunning, isAgentActivelyWorking } = agentPaneState();
    ctx.bl142.running = isAgentCliRunning('/usr/local/bin/fixturetool', '');
    ctx.bl142.busy = isAgentActivelyWorking('/usr/local/bin/fixturetool', 'doing a fixture thing right now');
    ctx.bl142.startupMessage = agentPaneState().agentPaneStatusMessage('zsh', '', 'fixturetool');
  });

  scoped(/^the provider is recognized and its busy, running, and startup states are detected from the descriptor$/, (ctx) => {
    assert.equal(ctx.bl142.running, true, 'expected the newly-registered provider to be recognized as running');
    assert.equal(ctx.bl142.busy, true, 'expected the newly-registered provider\'s busy pattern to be honored');
    assert.match(ctx.bl142.startupMessage, /FixtureTool/, `expected the startup message to name the new descriptor, got: ${ctx.bl142.startupMessage}`);
    // Cleanup: never leave a fixture descriptor in the shared registry
    // for a later scenario or file in the same process to see.
    const { PROVIDER_DESCRIPTORS } = agentPaneState();
    const idx = PROVIDER_DESCRIPTORS.indexOf(ctx.bl142.descriptor);
    if (idx >= 0) PROVIDER_DESCRIPTORS.splice(idx, 1);
  });

  scoped(/^no detection function is edited to add it$/, () => {
    // The previous step's whole premise: recognition came purely from a
    // pushed DATA entry, with isAgentCliRunning/isAgentActivelyWorking's
    // own code never touched. Re-affirms the structural check.
    assert.ok(detectionFunctionsSourceHasNoBrandLiteral());
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^a pane whose provider has not started yet$/, (ctx) => {
    ctx.bl142 = { paneCommand: 'zsh', paneText: '', expectedProvider: 'aider' };
  });

  scoped(/^the startup guidance message is produced$/, (ctx) => {
    const { agentPaneStatusMessage } = agentPaneState();
    ctx.bl142.message = agentPaneStatusMessage(ctx.bl142.paneCommand, ctx.bl142.paneText, ctx.bl142.expectedProvider);
  });

  scoped(/^it names the provider from its descriptor$/, (ctx) => {
    assert.match(ctx.bl142.message, /Aider/, `expected the message to name Aider, got: ${ctx.bl142.message}`);
  });

  scoped(/^it is not a hardcoded "Claude" literal$/, (ctx) => {
    assert.doesNotMatch(ctx.bl142.message, /Claude/, `expected no hardcoded Claude literal, got: ${ctx.bl142.message}`);
  });
}

module.exports = { registerSteps };
