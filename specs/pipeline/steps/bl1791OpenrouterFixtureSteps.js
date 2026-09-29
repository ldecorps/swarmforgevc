'use strict';

// BL-1791: step handlers for "the OpenRouter provider test's fixture names
// no qwen slug on an OpenRouter role". Scenario 01 reads the real fixture
// source; scenario 02 runs the real shell test, never a reimplementation.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FEATURE = "BL-1791 the OpenRouter provider test's fixture names no qwen slug on an OpenRouter role";
const TARGET_FILE = 'swarmforge/scripts/test/test_openrouter_provider_support.sh';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ─────────────────────────────────────────────────────────
  scoped(/^the source of (\S+) is read$/, (ctx, file) => {
    ctx.file = file;
    ctx.source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  });

  scoped(/^no window line of its fixture conf carries a --model qwen slug$/, (ctx) => {
    const windowLines = ctx.source
      .split('\n')
      .filter((line) => /^window\s/.test(line.trim()));
    assert.ok(windowLines.length > 0, `${ctx.file}: no window lines found in fixture conf`);
    for (const line of windowLines) {
      assert.doesNotMatch(
        line,
        /--model\s+qwen\//,
        `${ctx.file}: window line carries a qwen slug: ${line}`
      );
    }
  });

  // ── Scenario 02 ─────────────────────────────────────────────────────────
  scoped(/^swarmforge\/scripts\/test\/test_openrouter_provider_support\.sh runs$/, (ctx) => {
    const result = spawnSync('bash', [path.join(REPO_ROOT, TARGET_FILE)], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    ctx.status = result.status;
    ctx.stdout = result.stdout;
    ctx.stderr = result.stderr;
  });

  scoped(/^it exits 0 and prints ALL PASS$/, (ctx) => {
    assert.equal(ctx.status, 0, `expected exit 0, got ${ctx.status}\nstdout: ${ctx.stdout}\nstderr: ${ctx.stderr}`);
    assert.match(ctx.stdout, /ALL PASS|All BL-523 OpenRouter provider-support tests passed\./, `expected an ALL PASS verdict, got:\n${ctx.stdout}`);
  });
}

module.exports = { registerSteps };
