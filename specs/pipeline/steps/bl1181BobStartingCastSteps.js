'use strict';

// BL-1181: BoB starting cast steward export + ModelFactory apply acceptance steps.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  applyBobCast,
  assertKnownApplyPath,
} = require('../../../extension/out/tools/bobStartingCastApply');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const BOB_CLI = path.join(SCRIPTS_DIR, 'bob_starting_cast_cli.bb');
const FEATURE = 'BoB starting cast is steward-exported and applied via existing assignment paths';

const KNOWN_ROLES = ['architect', 'coder', 'cleaner', 'QA', 'hardender', 'documenter', 'specifier'];

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function ensure(ctx) {
  if (!ctx.bl1181) ctx.bl1181 = {};
  return ctx.bl1181;
}

function seedRegistry(stewardDir, roleModels) {
  const models = {};
  const roleMatrix = {};
  for (const [role, spec] of Object.entries(roleModels)) {
    const { provider, model, score = 0.9 } = spec;
    const key = `${provider}/${model}`;
    models[key] = {
      provider,
      model,
      status: 'certified',
      cost_class: 'medium',
      certification_report_path: null,
    };
    roleMatrix[role] = [{ provider, model, score, evidence: 'battery fixture BL-1181' }];
  }
  fs.writeFileSync(
    path.join(stewardDir, 'registry.json'),
    JSON.stringify({ models, capabilities: {}, role_matrix: roleMatrix, adapters: {} })
  );
}

function bb(ctx, args) {
  return execFileSync('bb', [BOB_CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MODEL_STEWARD_STATE_DIR: ctx.stewardStateDir,
      MODEL_FACTORY_STATE_DIR: ctx.factoryStateDir,
    },
  }).trim();
}

function registerSteps(registry) {
  scoped(registry, /^Model Steward rankings and ModelFactory assignment surfaces$/, () => {});

  scoped(registry, /^the steward cherry-picks a BoB starting cast$/, (ctx) => {
    const st = ensure(ctx);
    st.stewardStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1181-steward-'));
    st.factoryStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1181-factory-'));
    seedRegistry(st.stewardStateDir, {
      coder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      architect: { provider: 'openai', model: 'gpt-5.3-codex' },
      cleaner: { provider: 'cerebras', model: 'llama-3.3-70b' },
      QA: { provider: 'anthropic', model: 'claude-opus-4-8' },
      hardender: { provider: 'openai', model: 'gpt-5.3-codex' },
      documenter: { provider: 'anthropic', model: 'claude-sonnet-5' },
      specifier: { provider: 'openai', model: 'gpt-5.3-codex' },
    });
    st.cast = JSON.parse(bb(ctx, ['export']));
  });

  scoped(registry, /^the cast names exactly one provider and model per role$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.cast.kind, 'bob-starting-cast');
    for (const role of KNOWN_ROLES) {
      const entry = st.cast.roles[role];
      assert.ok(entry, `missing role ${role}`);
      assert.ok(entry.provider && entry.model, `incomplete entry for ${role}`);
    }
  });

  scoped(registry, /^mixed vendors are allowed across roles$/, (ctx) => {
    const st = ensure(ctx);
    const providers = new Set(Object.values(st.cast.roles).map((e) => e.provider));
    assert.ok(providers.size > 1, 'expected mixed vendors across roles');
  });

  scoped(registry, /^a BoB starting cast export$/, (ctx) => {
    const st = ensure(ctx);
    st.stewardStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1181-steward-'));
    st.factoryStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1181-factory-'));
    seedRegistry(st.stewardStateDir, {
      coder: { provider: 'anthropic', model: 'claude-sonnet-5' },
      architect: { provider: 'openai', model: 'gpt-5.3-codex' },
    });
    st.cast = JSON.parse(bb(ctx, ['export']));
  });

  scoped(registry, /^the cast is applied$/, (ctx) => {
    const st = ensure(ctx);
    if (st.deps) {
      st.overlayAfterMemory = false;
      st.applyBobResult = applyBobCast({
        cast: st.cast,
        currentModels: st.currentModels,
        outgoingByRole: st.outgoingByRole,
        deps: st.deps,
        writeOverlay: () => {
          st.overlayAfterMemory = true;
          return { via: 'model-factory-overlay' };
        },
      });
      return;
    }
    st.applyResult = JSON.parse(bb(ctx, ['apply']));
  });

  scoped(registry, /^assignment goes through ModelFactory or pack model apply$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.applyResult.via, 'model-factory-overlay');
    const overlayPath = st.applyResult['overlay-path'] || st.applyResult.overlay_path;
    assert.ok(overlayPath, 'expected overlay path');
    assert.ok(fs.existsSync(overlayPath), 'overlay file must exist');
  });

  scoped(registry, /^no third assignment path is invented$/, (ctx) => {
    const st = ensure(ctx);
    assertKnownApplyPath(st.applyResult.via);
    assert.notEqual(st.applyResult.via, 'custom-assignment-writer');
  });

  scoped(registry, /^apply would change the model for role "([^"]+)"$/, (ctx, role) => {
    const st = ensure(ctx);
    st.role = role;
    st.cast = {
      kind: 'bob-starting-cast',
      schemaVersion: 1,
      roles: {
        [role]: {
          role,
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          agent: 'claude',
        },
      },
    };
    st.currentModels = { [role]: 'claude-sonnet-5' };
    st.outgoingByRole = {
      [role]: { role, transcriptSummary: 'bob cast continuity', openParcelIds: ['parcel-bl1181'] },
    };
    st.memoryCalls = { capture: 0, inject: 0 };
    st.deps = {
      capture: (state) => {
        st.memoryCalls.capture += 1;
        return { payload: { kind: 'portable-agent-memory-payload', schemaVersion: 1, role: state.role, continuitySummary: state.transcriptSummary, openParcelContext: { openParcelIds: [...state.openParcelIds] } } };
      },
      inject: (r, payload) => {
        st.memoryCalls.inject += 1;
        return { ok: true, role: r, continuitySummary: payload.continuitySummary, openParcelContext: payload.openParcelContext, pretendedContinuity: false };
      },
    };
  });

  scoped(registry, /^agent-memory transfer runs for that role before live work$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.applyBobResult.ok, true);
    assert.equal(st.memoryCalls.capture, 1);
    assert.equal(st.memoryCalls.inject, 1);
    assert.equal(st.overlayAfterMemory, true, 'overlay write must run after memory transfer');
    assert.deepEqual(st.applyBobResult.memoryTransferred, [st.role]);
  });
}

module.exports = { registerSteps };
