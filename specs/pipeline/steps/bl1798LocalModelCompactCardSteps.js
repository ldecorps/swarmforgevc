'use strict';

// BL-1798: step handlers for "A local-model seat starts from a compact
// card". Drives the REAL prompt_engine_cli.bb compose/compose-metadata
// commands (the same CLI swarmforge.sh shells out to at launch), never a
// reimplementation of the dispatch or note-reading logic.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const PROMPT_ENGINE_CLI = path.join(SCRIPTS_DIR, 'prompt_engine_cli.bb');

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value is validated against an explicit KNOWN_VALUES lookup, never a bare
// passthrough.
const KNOWN_AGENTS = new Set(['claude', 'codex', 'gemini', 'cursor', 'aider', 'local-model']);
const KNOWN_STYLES = new Set(['generic', 'aider', 'local-compact']);

function compose(role, agent) {
  return execFileSync('bb', [PROMPT_ENGINE_CLI, 'compose', agent, role, '0', ''], { encoding: 'utf8' });
}

function composeMetadata(role, agent) {
  const out = execFileSync('bb', [PROMPT_ENGINE_CLI, 'compose-metadata', agent, role, '0', ''], { encoding: 'utf8' });
  return JSON.parse(out);
}

function registerSteps(registry) {
  registry.define(/^the prompt factory composes the "([^"]+)" prompt for the "([^"]+)" agent$/, (ctx, role, agent) => {
    if (!KNOWN_AGENTS.has(agent)) {
      throw new Error(`bl1798: unrecognized agent "${agent}"`);
    }
    ctx.role = role;
    ctx.agent = agent;
    ctx.composed = compose(role, agent);
  });

  registry.define(/^the composed prompt is at most (\d+) characters$/, (ctx, maxChars) => {
    const limit = Number(maxChars);
    if (ctx.composed.length > limit) {
      throw new Error(`expected at most ${limit} characters, got ${ctx.composed.length}`);
    }
  });

  registry.define(/^it names ready_for_next\.sh, done_with_current\.sh and swarm_handoff\.sh$/, (ctx) => {
    for (const needle of ['ready_for_next.sh', 'done_with_current.sh', 'swarm_handoff.sh']) {
      if (!ctx.composed.includes(needle)) {
        throw new Error(`expected the composed prompt to name "${needle}"`);
      }
    }
  });

  registry.define(
    /^it names swarmforge\/roles\/coder\.prompt and swarmforge\/constitution\.prompt as where the full text lives$/,
    (ctx) => {
      for (const needle of ['swarmforge/roles/coder.prompt', 'swarmforge/constitution.prompt']) {
        if (!ctx.composed.includes(needle)) {
          throw new Error(`expected the composed prompt to name "${needle}"`);
        }
      }
    }
  );

  registry.define(/^the composed prompt equals the generic composition of that role$/, (ctx) => {
    const generic = compose(ctx.role, 'claude');
    if (ctx.composed !== generic) {
      throw new Error(
        `expected the ${ctx.agent} composition of "${ctx.role}" to equal the generic (claude) composition byte-for-byte; ` +
          `lengths were ${ctx.composed.length} vs ${generic.length}`
      );
    }
  });

  registry.define(/^its metadata names the "([^"]+)" bootstrap text style$/, (ctx, style) => {
    if (!KNOWN_STYLES.has(style)) {
      throw new Error(`bl1798: unrecognized style "${style}"`);
    }
    const metadata = composeMetadata(ctx.role, ctx.agent);
    if (metadata['bootstrap-text-style'] !== style) {
      throw new Error(`expected bootstrap-text-style "${style}", got "${metadata['bootstrap-text-style']}"`);
    }
  });
}

module.exports = { registerSteps };
