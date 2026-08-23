'use strict';

// BL-1077: step handlers for "A documented Qwen credential name is honored
// by the launch guard".
//
// Every scenario drives the REAL qwen_launch_guard_lib.sh — the same file
// write_role_launch_script embeds into generated launch scripts. Nothing
// here reimplements the fallback order or the refusal message.
//
// SAFETY: the suite never sources the operator shell profile. Every
// Qwen-family name is scrubbed before the case, and every credential value
// is an obviously-fake fixture literal (never a real key).

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = 'A documented Qwen credential name is honored by the launch guard';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'qwen_launch_guard_lib.sh');

const QWEN_FAMILY = [
  'QWEN_API_KEY',
  'BAILIAN_TOKEN_PLAN_API_KEY',
  'BAILIAN_CODING_PLAN_API_KEY',
  'BAILIAN_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_API_BASE',
  'OPENAI_BASE_URL',
  'SWARMFORGE_USE_QWEN',
];

const KNOWN_KEYS = new Set([
  'QWEN_API_KEY',
  'BAILIAN_TOKEN_PLAN_API_KEY',
  'BAILIAN_CODING_PLAN_API_KEY',
]);

const FIXTURE_PRIMARY = 'sk-fixture-bl1077-primary-not-a-real-key';
const FIXTURE_SECONDARY = 'sk-fixture-bl1077-secondary-not-a-real-key';
const TOKEN_PLAN_URL = 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1';

function scrubPrefix() {
  return QWEN_FAMILY.map((name) => `unset ${name}`).join('\n');
}

function runGuardBash(body) {
  const script = `${scrubPrefix()}\nsource '${GUARD_LIB}'\n${body}`;
  return spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
    },
  });
}

function registerSteps(registry) {
  const define = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  define(/^no Qwen-family credential is present in the launching environment$/, (ctx) => {
    ctx.exports = {};
    ctx.optInFlag = false;
    ctx.guardKind = null;
    ctx.guardResult = null;
  });

  define(/^"([^"]+)" is exported with a fixture credential$/, (ctx, key) => {
    assert.ok(KNOWN_KEYS.has(key), `unknown credential key: ${key}`);
    ctx.exports = ctx.exports || {};
    ctx.exports[key] = FIXTURE_PRIMARY;
    ctx.primaryKey = key;
  });

  define(/^"([^"]+)" is exported with a different fixture credential$/, (ctx, key) => {
    assert.ok(KNOWN_KEYS.has(key), `unknown credential key: ${key}`);
    ctx.exports = ctx.exports || {};
    ctx.exports[key] = FIXTURE_SECONDARY;
  });

  define(/^the pack opts into Qwen through the environment flag$/, (ctx) => {
    ctx.optInFlag = true;
  });

  define(/^the launch guard for a pack whose CLI carries the Token Plan endpoint runs$/, (ctx) => {
    const exportLines = Object.entries(ctx.exports || {})
      .map(([k, v]) => `export ${k}='${v}'`)
      .join('\n');
    const body = `
${exportLines}
set +e
qwen_guard_require_token_plan_endpoint
status=$?
set -e
printf 'STATUS=%s\\n' "$status"
printf 'OPENAI_API_KEY=%s\\n' "\${OPENAI_API_KEY-}"
printf 'OPENAI_API_BASE=%s\\n' "\${OPENAI_API_BASE-}"
printf 'QWEN_API_KEY=%s\\n' "\${QWEN_API_KEY-}"
`;
    const res = runGuardBash(body);
    ctx.guardKind = 'strict';
    ctx.guardResult = res;
    ctx.guardStdout = res.stdout || '';
    ctx.guardStderr = res.stderr || '';
  });

  define(/^the launch guard for a pack whose CLI carries no endpoint URL runs$/, (ctx) => {
    const exportLines = Object.entries(ctx.exports || {})
      .map(([k, v]) => `export ${k}='${v}'`)
      .join('\n');
    const flagLine = ctx.optInFlag ? 'export SWARMFORGE_USE_QWEN=1' : 'unset SWARMFORGE_USE_QWEN';
    const body = `
${exportLines}
${flagLine}
qwen_guard_map_if_flagged
printf 'STATUS=0\\n'
printf 'OPENAI_API_KEY=%s\\n' "\${OPENAI_API_KEY-}"
printf 'OPENAI_API_BASE=%s\\n' "\${OPENAI_API_BASE-}"
printf 'QWEN_API_KEY=%s\\n' "\${QWEN_API_KEY-}"
`;
    const res = runGuardBash(body);
    ctx.guardKind = 'soft';
    ctx.guardResult = res;
    ctx.guardStdout = res.stdout || '';
    ctx.guardStderr = res.stderr || '';
    assert.equal(res.status, 0, `soft guard bash failed: ${res.stderr}`);
  });

  define(/^the OpenAI-compatible key is set to that fixture credential$/, (ctx) => {
    assert.match(ctx.guardStdout, new RegExp(`^OPENAI_API_KEY=${FIXTURE_PRIMARY}$`, 'm'));
  });

  define(/^the OpenAI-compatible key is set to the QWEN_API_KEY fixture credential$/, (ctx) => {
    assert.match(ctx.guardStdout, new RegExp(`^OPENAI_API_KEY=${FIXTURE_PRIMARY}$`, 'm'));
    assert.doesNotMatch(ctx.guardStdout, new RegExp(`OPENAI_API_KEY=${FIXTURE_SECONDARY}`));
  });

  define(/^the OpenAI-compatible base URL is the Token Plan endpoint$/, (ctx) => {
    assert.match(ctx.guardStdout, new RegExp(`^OPENAI_API_BASE=${TOKEN_PLAN_URL.replace(/\./g, '\\.')}$`, 'm'));
  });

  define(/^the guard refuses to launch$/, (ctx) => {
    assert.match(ctx.guardStdout, /^STATUS=1$/m);
    assert.ok((ctx.guardStderr || '').length > 0, 'expected a refusal message on stderr');
  });

  define(/^the refusal message names every accepted credential variable$/, (ctx) => {
    const msg = ctx.guardStderr || '';
    for (const name of KNOWN_KEYS) {
      assert.match(msg, new RegExp(name), `refusal must name ${name}`);
    }
  });
}

module.exports = { registerSteps };
