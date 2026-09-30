'use strict';

// BL-1800: step handlers for "QA, coordinator and specifier get
// local-model cards". Reuses BL-1798's own unscoped steps (compose/
// char-limit/names ready_for_next.sh etc.) for the generic assertions;
// this file adds the assertions specific to this ticket's own scenarios.
// Drives the REAL prompt_engine_cli.bb compose/compose-metadata commands
// and the REAL local-model-mono-router.conf pack file, never a
// reimplementation.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FEATURE = 'BL-1800 QA, coordinator and specifier get local-model cards';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const PROMPT_ENGINE_CLI = path.join(SCRIPTS_DIR, 'prompt_engine_cli.bb');
const PACK_FILE = path.join(REPO_ROOT, 'swarmforge', 'packs', 'local-model-mono-router.conf');

function compose(role, agent) {
  return execFileSync('bb', [PROMPT_ENGINE_CLI, 'compose', agent, role, '0', ''], { encoding: 'utf8' });
}

function composeMetadata(role, agent) {
  const out = execFileSync('bb', [PROMPT_ENGINE_CLI, 'compose-metadata', agent, role, '0', ''], { encoding: 'utf8' });
  return JSON.parse(out);
}

// The pack file's own window lines name every role it staffs; its
// coordinator is staffed separately via `config coordinator_agent`. Read
// BOTH from the real file rather than hard-coding the roster, so a role
// added to or dropped from the pack changes what this census counts
// without an edit here (BL-1445: the census must not go green on a short
// hard-coded list).
function rolesStaffedByPack() {
  const text = fs.readFileSync(PACK_FILE, 'utf8');
  const windowRoles = [...text.matchAll(/^window\s+(\S+)/gm)].map((m) => m[1]);
  const hasCoordinatorAgent = /^config\s+coordinator_agent\s+\S+/m.test(text);
  const roles = [...windowRoles];
  if (hasCoordinatorAgent && !roles.includes('coordinator')) {
    roles.push('coordinator');
  }
  return roles;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^it names swarmforge\/roles\/([a-zA-Z-]+)\.prompt and swarmforge\/constitution\.prompt as where the full text lives$/,
    (ctx, role) => {
      for (const needle of [`swarmforge/roles/${role}.prompt`, 'swarmforge/constitution.prompt']) {
        if (!ctx.composed.includes(needle)) {
          throw new Error(`expected the composed prompt to name "${needle}"`);
        }
      }
    }
  );

  scoped(/^it tells the seat to refuse deprecator adjudication and escalate it to a hard-tier seat or the human$/, (ctx) => {
    const lower = ctx.composed.toLowerCase();
    if (!/deprecator/.test(lower) || !/refuse/.test(lower)) {
      throw new Error(`expected the composed prompt to tell the seat to refuse deprecator adjudication, got:\n${ctx.composed}`);
    }
    if (!/escalate/.test(lower) || !(/hard-tier/.test(lower) || /human/.test(lower))) {
      throw new Error(`expected the composed prompt to say to escalate to a hard-tier seat or the human, got:\n${ctx.composed}`);
    }
  });

  scoped(/^the prompt factory composes every role local-model-mono-router\.conf staffs for the "([^"]+)" agent$/, (ctx, agent) => {
    ctx.agent = agent;
    ctx.roleRoster = rolesStaffedByPack();
    ctx.composedByRole = {};
    ctx.metadataByRole = {};
    for (const role of ctx.roleRoster) {
      ctx.composedByRole[role] = compose(role, agent);
      ctx.metadataByRole[role] = composeMetadata(role, agent);
    }
  });

  scoped(/^each composed prompt names the "([^"]+)" bootstrap text style and is at most (\d+) characters$/, (ctx, style, maxChars) => {
    const limit = Number(maxChars);
    for (const role of ctx.roleRoster) {
      const metadata = ctx.metadataByRole[role];
      if (metadata['bootstrap-text-style'] !== style) {
        throw new Error(`expected ${role} bootstrap-text-style "${style}", got "${metadata['bootstrap-text-style']}"`);
      }
      const composed = ctx.composedByRole[role];
      if (composed.length > limit) {
        throw new Error(`expected ${role}'s composed prompt at most ${limit} characters, got ${composed.length}`);
      }
    }
  });

  scoped(/^the census is exactly (\d+) roles and includes "([^"]+)"$/, (ctx, count, mustInclude) => {
    const expected = Number(count);
    if (ctx.roleRoster.length !== expected) {
      throw new Error(`expected exactly ${expected} roles, got ${ctx.roleRoster.length}: ${JSON.stringify(ctx.roleRoster)}`);
    }
    if (!ctx.roleRoster.includes(mustInclude)) {
      throw new Error(`expected the census to include "${mustInclude}", got: ${JSON.stringify(ctx.roleRoster)}`);
    }
  });
}

module.exports = { registerSteps };
