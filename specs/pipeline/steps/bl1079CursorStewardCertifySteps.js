'use strict';

// BL-1079: step handlers for "a Cursor identity is certified on evidence
// before production routing".
//
// Drives the REAL model_steward_cli.bb (and for scenario 04, the REAL
// model_factory_lib.bb + swarmforge.sh validate_agent source). Never
// re-implements seed/certify/allow-list decisions in JS. Each scenario gets
// an isolated MODEL_STEWARD_STATE_DIR so acceptance never mutates this
// repo's real .swarmforge/model-steward/.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'a Cursor identity is certified on evidence before production routing';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const MODEL_STEWARD_CLI = path.join(SCRIPTS_DIR, 'model_steward_cli.bb');
const MODEL_FACTORY_LIB = path.join(SCRIPTS_DIR, 'model_factory_lib.bb');
const MODEL_STEWARD_LIB = path.join(SCRIPTS_DIR, 'model_steward_lib.bb');
const SWARMFORGE_SH = path.join(SCRIPTS_DIR, 'swarmforge.sh');
const SEED_FILE = path.join(REPO_ROOT, 'swarmforge', 'model-steward', 'seed', 'models.seed.json');

const CURSOR_PROVIDER = 'cursor';
const CURSOR_MODEL = 'auto';
const CURSOR_ID = `${CURSOR_PROVIDER}/${CURSOR_MODEL}`;

// BL-421: every Examples column value resolves through an explicit lookup.
const KNOWN_EVIDENCE = new Set(['absent', 'present']);
const KNOWN_STATUSES = new Set(['candidate', 'certified']);
const KNOWN_REPORTS = {
  'is unchanged': 'unchanged',
  'names the scorecard it read': 'names-scorecard',
};

function cli(stateDir, args, { allowFail = false } = {}) {
  try {
    return {
      status: 0,
      stdout: execFileSync('bb', [MODEL_STEWARD_CLI, ...args], {
        encoding: 'utf8',
        env: { ...process.env, MODEL_STEWARD_STATE_DIR: stateDir },
      }),
      stderr: '',
    };
  } catch (err) {
    if (!allowFail) throw err;
    return {
      status: typeof err.status === 'number' ? err.status : 1,
      stdout: err.stdout ? String(err.stdout) : '',
      stderr: err.stderr ? String(err.stderr) : String(err.message || ''),
    };
  }
}

function showEntry(stateDir, provider, model) {
  return JSON.parse(cli(stateDir, ['show', `${provider}/${model}`]).stdout);
}

function scorecardRel(provider, model) {
  return `scorecards/${provider}__${model}.json`;
}

function plantScorecard(stateDir, provider, model) {
  const rel = scorecardRel(provider, model);
  fs.mkdirSync(path.join(stateDir, 'scorecards'), { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, rel),
    JSON.stringify({
      model,
      entries: [{ competency: 'receive', status: 'pass' }],
      overall: 'swarm-compliant',
    })
  );
  return rel;
}

function bbJson(program) {
  const res = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(res.status, 0, `babashka failed:\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

function launcherAllowListTokens() {
  const src = fs.readFileSync(SWARMFORGE_SH, 'utf8');
  const fn = src.match(/^validate_agent\(\) \{[\s\S]*?^\}$/m);
  assert.ok(fn, 'validate_agent could not be located in the launcher');
  assert.match(fn[0], /Unsupported agent/, 'extracted function is not the allow-list');
  const alts = fn[0].match(/^\s+([a-z0-9_|]+)\)\s*;;\s*$/m);
  assert.ok(alts, 'validate_agent case arm with agent tokens was not found');
  return new Set(alts[1].split('|').filter(Boolean));
}

function registerSteps(registry) {
  const define = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  // ── Background ─────────────────────────────────────────────────────────
  define(/^the steward registry built from the committed model steward seed$/, (ctx) => {
    assert.ok(fs.existsSync(SEED_FILE), `expected committed seed at ${SEED_FILE}`);
    ctx.seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    ctx.stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1079-steward-'));
    // First CLI call initialises the runtime registry from the committed seed.
    cli(ctx.stateDir, ['status']);
    ctx.anthropicBefore = showEntry(ctx.stateDir, 'anthropic', 'claude-sonnet-5');
  });

  // ── cursor-identity-steward-certified-01 ───────────────────────────────
  define(/^the Cursor identity is looked up in that registry$/, (ctx) => {
    ctx.cursorEntry = showEntry(ctx.stateDir, CURSOR_PROVIDER, CURSOR_MODEL);
  });

  define(/^it is present with status candidate$/, (ctx) => {
    assert.equal(ctx.cursorEntry.status, 'candidate');
  });

  define(/^its provider is cursor rather than a borrowed vendor name$/, (ctx) => {
    assert.equal(ctx.cursorEntry.provider, CURSOR_PROVIDER);
    assert.equal(ctx.cursorEntry.model, CURSOR_MODEL);
  });

  define(/^no anthropic identity was added or altered by the seed change$/, (ctx) => {
    const after = showEntry(ctx.stateDir, 'anthropic', 'claude-sonnet-5');
    assert.deepEqual(after, ctx.anthropicBefore, 'anthropic/claude-sonnet-5 changed across the Cursor seed');
    const seedAnthropic = (ctx.seed.models || []).filter((m) => m.provider === 'anthropic');
    assert.equal(seedAnthropic.length, 1, 'seed must still carry exactly one anthropic identity');
    assert.equal(seedAnthropic[0].model, 'claude-sonnet-5');
    assert.equal(seedAnthropic[0].status, 'certified');
    const borrowed = (ctx.seed.models || []).filter(
      (m) => m.provider === 'anthropic' && /cursor/i.test(String(m.model))
    );
    assert.equal(borrowed.length, 0, 'Cursor must not be registered under a borrowed anthropic id');
  });

  // ── cursor-identity-steward-certified-02 ───────────────────────────────
  define(/^role candidates for role documenter are listed including uncertified ones$/, (ctx) => {
    const out = cli(ctx.stateDir, ['role-matrix', 'documenter', '--include-uncertified']).stdout;
    ctx.roleLines = out.trim().split('\n').filter(Boolean);
  });

  define(/^the Cursor identity is among them$/, (ctx) => {
    assert.ok(
      ctx.roleLines.some((line) => line.startsWith(`${CURSOR_ID} `)),
      `expected ${CURSOR_ID} in role-matrix documenter --include-uncertified, got:\n${ctx.roleLines.join('\n')}`
    );
  });

  define(/^it carries a capability entry and a production adapter entry$/, (ctx) => {
    const cap = JSON.parse(cli(ctx.stateDir, ['capability', CURSOR_ID]).stdout);
    for (const dim of ['coding_quality', 'protocol_compliance', 'tool_usage', 'autonomy', 'cost_latency']) {
      assert.ok(cap[dim], `capability missing ${dim}: ${JSON.stringify(cap)}`);
    }
    const adapterOut = cli(ctx.stateDir, ['adapter', CURSOR_ID]).stdout.trim();
    assert.match(adapterOut, /^generic\b/, `expected a production adapter catalogue entry, got: ${adapterOut}`);
  });

  // ── cursor-identity-steward-certified-03 ───────────────────────────────
  define(/^a compliance battery scorecard for the Cursor identity that is (\S+)$/, (ctx, evidence) => {
    assert.ok(KNOWN_EVIDENCE.has(evidence), `unrecognized Examples <evidence>: "${evidence}"`);
    ctx.evidence = evidence;
    ctx.wantedScorecard = scorecardRel(CURSOR_PROVIDER, CURSOR_MODEL);
    ctx.beforeEntry = showEntry(ctx.stateDir, CURSOR_PROVIDER, CURSOR_MODEL);
    if (evidence === 'present') {
      ctx.scorecardPath = plantScorecard(ctx.stateDir, CURSOR_PROVIDER, CURSOR_MODEL);
    } else {
      const p = path.join(ctx.stateDir, ctx.wantedScorecard);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  define(/^certify is run for that identity$/, (ctx) => {
    ctx.certify = cli(ctx.stateDir, ['certify', CURSOR_ID], { allowFail: true });
    ctx.certifyCombined = `${ctx.certify.stdout}${ctx.certify.stderr}`;
  });

  define(/^its status is (\S+)$/, (ctx, status) => {
    assert.ok(KNOWN_STATUSES.has(status), `unrecognized Examples <status>: "${status}"`);
    const entry = showEntry(ctx.stateDir, CURSOR_PROVIDER, CURSOR_MODEL);
    ctx.afterEntry = entry;
    assert.equal(entry.status, status);
  });

  define(/^its recorded certification report (.+)$/, (ctx, reportPhrase) => {
    const kind = KNOWN_REPORTS[reportPhrase];
    assert.ok(kind, `unrecognized Examples <report>: "${reportPhrase}"`);
    if (kind === 'unchanged') {
      assert.equal(
        ctx.afterEntry.certification_report_path,
        ctx.beforeEntry.certification_report_path,
        'absent scorecard must leave certification_report_path unchanged'
      );
      assert.notEqual(ctx.certify.status, 0, 'absent scorecard must make certify exit non-zero');
    } else {
      assert.ok(ctx.afterEntry.certification_report_path, 'expected a certification report path');
      const report = JSON.parse(
        fs.readFileSync(path.join(ctx.stateDir, ctx.afterEntry.certification_report_path), 'utf8')
      );
      assert.equal(report.scorecard_path, ctx.scorecardPath);
      assert.equal(ctx.certify.status, 0, `certify failed:\n${ctx.certifyCombined}`);
    }
  });

  define(/^the command output names the scorecard artifact by path$/, (ctx) => {
    const named = ctx.evidence === 'present' ? ctx.scorecardPath : ctx.wantedScorecard;
    assert.ok(
      ctx.certifyCombined.includes(named),
      `expected certify output to name ${named}, got:\n${ctx.certifyCombined}`
    );
  });

  // ── cursor-identity-steward-certified-04 ───────────────────────────────
  define(/^the agent token ModelFactory derives for provider cursor is resolved$/, (ctx) => {
    // Load the REAL lib — never restate "cursor" here as the expected token.
    ctx.derivedToken = bbJson(`
      (load-file "${MODEL_STEWARD_LIB}")
      (load-file "${MODEL_FACTORY_LIB}")
      (require '[cheshire.core :as json])
      (print (json/generate-string (model-factory-lib/agent-for-provider "cursor")))
    `);
    assert.equal(typeof ctx.derivedToken, 'string');
    assert.ok(ctx.derivedToken.length > 0, 'derived agent token must be non-empty');
  });

  define(/^the shell launcher's agent allow-list is read from its own source$/, (ctx) => {
    ctx.allowList = launcherAllowListTokens();
    assert.ok(ctx.allowList.size > 0, 'launcher allow-list parsed empty');
  });

  define(/^that token appears in that allow-list$/, (ctx) => {
    assert.ok(
      ctx.allowList.has(ctx.derivedToken),
      `derived token ${JSON.stringify(ctx.derivedToken)} not in allow-list ${[...ctx.allowList].join('|')}`
    );
  });

  define(/^the two literals are compared rather than restated in a comment$/, (ctx) => {
    // Re-derive and re-read, then compare the live values to each other.
    // A step that only asserted `assert.equal(ctx.derivedToken, 'cursor')`
    // would restate the token and miss allow-list drift.
    const again = bbJson(`
      (load-file "${MODEL_STEWARD_LIB}")
      (load-file "${MODEL_FACTORY_LIB}")
      (require '[cheshire.core :as json])
      (print (json/generate-string (model-factory-lib/agent-for-provider "cursor")))
    `);
    const allowAgain = launcherAllowListTokens();
    assert.equal(again, ctx.derivedToken, 'derived token was not stable across re-reads');
    assert.ok(allowAgain.has(again), 're-read allow-list no longer contains the derived token');
    assert.deepEqual([...allowAgain].sort(), [...ctx.allowList].sort(), 'allow-list drifted mid-scenario');
  });
}

module.exports = { registerSteps };
