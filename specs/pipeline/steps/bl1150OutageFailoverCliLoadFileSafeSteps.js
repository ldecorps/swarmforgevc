'use strict';

// BL-1150: outage_failover_cli.bb must be load-file safe (handoffd) and still
// runnable as a bb entrypoint. Drives the REAL CLI — never reimplements the guard.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'outage_failover_cli.bb');
const LOAD_HARNESS = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'test_outage_failover_cli_load_file_safe.bb'
);

const FEATURE = 'outage_failover_cli is load-file safe and still runnable as entrypoint';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function registerSteps(registry) {
  scoped(registry, /^the outage_failover_cli\.bb script under swarmforge\/scripts$/, (ctx) => {
    if (!fs.existsSync(CLI)) {
      throw new Error(`missing CLI at ${CLI}`);
    }
    ctx.cliPath = CLI;
  });

  scoped(registry, /^a harness load-files outage_failover_cli\.bb$/, (ctx) => {
    const res = spawnSync('bb', [LOAD_HARNESS], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    ctx.loadHarness = {
      status: res.status,
      signal: res.signal,
      out: `${res.stdout || ''}${res.stderr || ''}`,
    };
  });

  scoped(registry, /^the harness process is still alive$/, (ctx) => {
    const { status, signal, out } = ctx.loadHarness || {};
    if (status !== 0 || signal) {
      throw new Error(
        `expected load-file harness exit 0 (alive), got status=${status} signal=${signal}:\n${out}`
      );
    }
    if (!out.includes('PASS: load-file')) {
      throw new Error(`expected PASS line from load-file harness, got:\n${out}`);
    }
  });

  scoped(registry, /^-main was not invoked$/, (ctx) => {
    const { out } = ctx.loadHarness || {};
    if (/Usage:\s*outage_failover_cli/.test(out)) {
      throw new Error(`-main/usage ran during load-file:\n${out}`);
    }
    if (/FAIL: load-file invoked usage/.test(out)) {
      throw new Error(`harness reported -main invocation:\n${out}`);
    }
  });

  scoped(
    registry,
    /^outage_failover_cli\.bb is run as a babashka entrypoint with no command$/,
    (ctx) => {
      const res = spawnSync('bb', [CLI], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      ctx.entrypoint = {
        status: res.status,
        out: `${res.stdout || ''}${res.stderr || ''}`,
      };
    }
  );

  scoped(
    registry,
    /^usage is printed or the process exits through -main intentionally$/,
    (ctx) => {
      const { status, out } = ctx.entrypoint || {};
      if (status === 0) {
        throw new Error(`expected non-zero exit from usage path, got 0:\n${out}`);
      }
      if (!/Usage:\s*outage_failover_cli/.test(out)) {
        throw new Error(`expected usage text from entrypoint -main, got:\n${out}`);
      }
    }
  );
}

module.exports = { registerSteps };
