'use strict';

// BL-749: call-site tracing before nit-downgrade of ticket guardrail gaps.
// Reads REAL role prompts and composePilotExpeditorPrompt — never stubs the rule text.
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_DIR = path.join(REPO_ROOT, 'extension');
const { composePilotExpeditorPrompt } = require(path.join(
  EXT_DIR,
  'out',
  'tools',
  'telegramCursorBridgePilot'
));

const CLEANER = path.join(REPO_ROOT, 'swarmforge', 'roles', 'cleaner.prompt');
const HARDENDER = path.join(REPO_ROOT, 'swarmforge', 'roles', 'hardender.prompt');

const FEATURE =
  'Review hats and /pilot never dismiss a ticket guardrail gap without call-site tracing';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function assertCallSiteBeforeNit(text, label) {
  const lower = text.toLowerCase();
  if (!/call[\s-]?site/.test(lower)) {
    throw new Error(`${label}: expected call-site language`);
  }
  if (!/nit/.test(lower)) {
    throw new Error(`${label}: expected nit-downgrade language`);
  }
  if (!/guardrail/.test(lower)) {
    throw new Error(`${label}: expected ticket guardrail language`);
  }
  if (!/not only the function in isolation|function in isolation/.test(lower)) {
    throw new Error(`${label}: expected call site vs function-in-isolation`);
  }
}

/** Assert the most recently loaded, not-yet-checked role prompt (cleaner then hardener). */
function assertNextUnreadRolePrompt(ctx) {
  const checks = [
    { key: 'cleanerPrompt', flag: '_cleanerChecked', label: 'cleaner.prompt' },
    { key: 'hardenderPrompt', flag: '_hardenderChecked', label: 'hardender.prompt' },
  ];
  for (const { key, flag, label } of checks) {
    if (ctx[key] && !ctx[flag]) {
      assertCallSiteBeforeNit(ctx[key], label);
      ctx[flag] = true;
      return;
    }
  }
  throw new Error('no unread role prompt loaded for call-site assertion');
}

function registerSteps(registry) {
  scoped(registry, /^the pilot expeditor prompt composer is available$/, () => {
    if (typeof composePilotExpeditorPrompt !== 'function') {
      throw new Error('composePilotExpeditorPrompt missing');
    }
  });

  scoped(registry, /^the cleaner role prompt is read$/, (ctx) => {
    ctx.cleanerPrompt = fs.readFileSync(CLEANER, 'utf8');
  });

  scoped(registry, /^the hardener role prompt is read$/, (ctx) => {
    ctx.hardenderPrompt = fs.readFileSync(HARDENDER, 'utf8');
  });

  scoped(
    registry,
    /^it requires call-site tracing before downgrading a ticket guardrail gap to a nit$/,
    (ctx) => {
      assertNextUnreadRolePrompt(ctx);
    }
  );

  scoped(registry, /^the offline expeditor prompt is composed for ticket "([^"]+)"$/, (ctx, ticket) => {
    ctx.pilotPrompt = composePilotExpeditorPrompt(ticket);
  });

  scoped(
    registry,
    /^the prompt requires call-site tracing before downgrading a ticket guardrail gap to a nit$/,
    (ctx) => {
      assertCallSiteBeforeNit(ctx.pilotPrompt || '', 'composePilotExpeditorPrompt');
    }
  );

  scoped(
    registry,
    /^the prompt requires reading the call site not only the function in isolation$/,
    (ctx) => {
      const text = ctx.pilotPrompt || '';
      if (!/call site/i.test(text) || !/function in isolation/i.test(text)) {
        throw new Error(`expected call site vs function in isolation, got:\n${text}`);
      }
    }
  );
}

module.exports = { registerSteps };
