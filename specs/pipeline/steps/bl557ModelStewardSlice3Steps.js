'use strict';

// BL-557 Slice 3: coordinator-assignable steward role + compat-docs.
// Drives the REAL model_steward_cli.bb and reads the graduated role prompt /
// launch surfaces from the tree — never re-implements registry projection.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'model_steward_cli.bb');
const ROLE_PROMPT = path.join(REPO_ROOT, 'swarmforge', 'roles', 'model-steward.prompt');
const FEATURE =
  'Model Steward is a coordinator-assignable role with generated compatibility docs';

const KNOWN_MODELS = {
  'claude-sonnet-5': { provider: 'anthropic' },
  'llama-3.3-70b': { provider: 'cerebras' },
  'old-model': { provider: 'acme' },
};
const KNOWN_STATUSES = new Set(['certified', 'candidate', 'deprecated']);

function cli(stateDir, args, extraEnv = {}) {
  return execFileSync('bb', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, MODEL_STEWARD_STATE_DIR: stateDir, ...extraEnv },
  });
}

/** Fixture limitation text for Outline status re-register (not production). */
function limitationFor(model, status) {
  if (model === 'old-model') return 'retired from swarm use';
  return status === 'certified'
    ? 'seed limitation for certified row'
    : 'seed limitation for non-certified row';
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the Model Steward registry is initialised$/, (ctx) => {
    ctx.bl557 = {
      stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bl557-model-steward-')),
    };
    cli(ctx.bl557.stateDir, ['status']);
  });

  scoped(/^the Model Registry contains certified and candidate models$/, (ctx) => {
    const status = cli(ctx.bl557.stateDir, ['status']);
    assert.match(status, /certified/, 'expected a certified model in the seeded registry');
    assert.match(status, /candidate/, 'expected a candidate model in the seeded registry');
  });

  scoped(/^the swarm infrastructure role prompts are read$/, (ctx) => {
    ctx.bl557 = { ...(ctx.bl557 || {}), rolePrompt: fs.readFileSync(ROLE_PROMPT, 'utf8') };
  });

  scoped(/^a model-steward role prompt exists under swarmforge\/roles\/$/, (ctx) => {
    assert.ok(fs.existsSync(ROLE_PROMPT), `missing ${ROLE_PROMPT}`);
    assert.ok(ctx.bl557.rolePrompt.length > 0, 'role prompt is empty');
    assert.ok(
      !/not yet a live|do not assign this file to a pane|Slice 1 stub/i.test(ctx.bl557.rolePrompt),
      'role prompt still carries Slice 1 stub language'
    );
  });

  scoped(/^it states the coordinator may assign steward tasks$/, (ctx) => {
    assert.match(
      ctx.bl557.rolePrompt,
      /coordinator MAY assign/i,
      'role prompt must state coordinator-assignable tasks'
    );
  });

  scoped(
    /^it states the steward emits certification updates without mutating production routing directly$/,
    (ctx) => {
      assert.match(
        ctx.bl557.rolePrompt,
        /never assign a model to a role|knowledge, not production routing|certification\/registry UPDATE/i,
        'role prompt must state knowledge-only / no direct routing mutation'
      );
    }
  );

  scoped(/^the swarm launch and teardown paths are inspected$/, (ctx) => {
    const packsDir = path.join(REPO_ROOT, 'swarmforge', 'packs');
    const packText = fs
      .readdirSync(packsDir)
      .filter((f) => f.endsWith('.conf'))
      .map((f) => fs.readFileSync(path.join(packsDir, f), 'utf8'))
      .join('\n');
    const rolesTsv = fs.existsSync(path.join(REPO_ROOT, '.swarmforge', 'roles.tsv'))
      ? fs.readFileSync(path.join(REPO_ROOT, '.swarmforge', 'roles.tsv'), 'utf8')
      : '';
    const rolesTemplate = fs.existsSync(path.join(REPO_ROOT, 'swarmforge', 'roles.tsv'))
      ? fs.readFileSync(path.join(REPO_ROOT, 'swarmforge', 'roles.tsv'), 'utf8')
      : '';
    ctx.bl557 = {
      ...(ctx.bl557 || {}),
      launchSurfaces: `${packText}\n${rolesTsv}\n${rolesTemplate}`,
    };
  });

  scoped(/^no always-on model-steward session is added$/, (ctx) => {
    assert.ok(
      !/(^|\s)model-steward(\s|$)/m.test(ctx.bl557.launchSurfaces),
      'launch/roles surfaces must not name a model-steward session'
    );
  });

  scoped(/^the steward has no mailbox, worktree, or standing loop$/, (ctx) => {
    const prompt = fs.readFileSync(ROLE_PROMPT, 'utf8');
    assert.match(prompt, /no always-on steward pane/i);
    assert.match(prompt, /mailbox/i);
    assert.match(prompt, /worktree/i);
    assert.match(prompt, /standing loop/i);
    assert.ok(
      !fs.existsSync(path.join(REPO_ROOT, '.worktrees', 'model-steward')),
      'unexpected .worktrees/model-steward checkout'
    );
  });

  scoped(/^model-steward compat-docs is generated$/, (ctx) => {
    const st = ctx.bl557 || {};
    if (!st.stateDir) {
      st.stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl557-model-steward-'));
      cli(st.stateDir, ['status']);
    }
    const outPath = path.join(st.stateDir, 'model-compatibility.md');
    cli(st.stateDir, ['compat-docs', '--out', outPath]);
    st.compatDoc = fs.readFileSync(outPath, 'utf8');
    st.compatPath = outPath;
    ctx.bl557 = st;
  });

  scoped(/^the document lists each registered model with its certification status$/, (ctx) => {
    const doc = ctx.bl557.compatDoc;
    const status = cli(ctx.bl557.stateDir, ['status']).trim().split('\n').filter(Boolean);
    for (const line of status) {
      const [id, st] = line.split(' ');
      assert.ok(doc.includes(id), `compat-docs missing model ${id}`);
      assert.ok(doc.includes(`**Status:** ${st}`), `compat-docs missing status ${st} for ${id}`);
    }
  });

  scoped(/^the document lists each model's known limitations$/, (ctx) => {
    assert.match(ctx.bl557.compatDoc, /Known limitations/i);
  });

  scoped(/^the document links to the role recommendation matrix$/, (ctx) => {
    assert.match(ctx.bl557.compatDoc, /#role-recommendation-matrix/);
    assert.match(ctx.bl557.compatDoc, /## Role recommendation matrix/);
  });

  scoped(/^model "([^"]+)" has registry status "([^"]+)"$/, (ctx, model, status) => {
    if (!(model in KNOWN_MODELS)) {
      throw new Error(`BL-557: unrecognized model "${model}" — not in KNOWN_VALUES`);
    }
    if (!KNOWN_STATUSES.has(status)) {
      throw new Error(`BL-557: unrecognized status "${status}" — not in KNOWN_VALUES`);
    }
    const st = ctx.bl557;
    const { provider } = KNOWN_MODELS[model];
    const id = `${provider}/${model}`;
    // Re-register to pin Outline status without certify's scorecard.
    cli(st.stateDir, [
      'register',
      id,
      '--status',
      status,
      '--limitations',
      limitationFor(model, status),
    ]);
    ctx.bl557 = { ...st, expectModel: model, expectStatus: status, expectId: id };
  });

  scoped(/^the document shows model "([^"]+)" with status "([^"]+)"$/, (ctx, model, status) => {
    assert.equal(model, ctx.bl557.expectModel);
    assert.equal(status, ctx.bl557.expectStatus);
    const doc = ctx.bl557.compatDoc;
    assert.ok(doc.includes(ctx.bl557.expectId), `missing ${ctx.bl557.expectId}`);
    // Status line for that model section
    const idx = doc.indexOf(`### ${ctx.bl557.expectId}`);
    assert.ok(idx >= 0, `missing section for ${ctx.bl557.expectId}`);
    const section = doc.slice(idx, idx + 400);
    assert.ok(
      section.includes(`**Status:** ${status}`),
      `section for ${ctx.bl557.expectId} missing status ${status}:\n${section}`
    );
  });
}

module.exports = { registerSteps };
