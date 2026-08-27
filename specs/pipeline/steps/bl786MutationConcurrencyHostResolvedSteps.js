'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXT_OUT = path.join(REPO_ROOT, 'extension', 'out');
const MB = 1024 * 1024;

const {
  resolveMutationConcurrency,
  launchMutationCommand,
  formatMutationConcurrencyReport,
  MUTATION_CONCURRENCY_ENV,
} = require(path.join(EXT_OUT, 'tools', 'resolve-mutation-concurrency'));
const {
  DECLARED_PEAK_RSS_PER_WORKER_BYTES,
  DEFAULT_RESERVE_BYTES,
} = require(path.join(EXT_OUT, 'metrics', 'mutationConcurrencyConstants'));

const FEATURE = 'Mutation concurrency is resolved from the launching host';

const MUTATION_SCRIPT_NAMES = ['mutation', 'mutation:lets-talk-cursor-bridge'];

function ensureState(ctx) {
  if (!ctx.bl786) {
    ctx.bl786 = {
      peakBytes: DECLARED_PEAK_RSS_PER_WORKER_BYTES,
      reserveBytes: DEFAULT_RESERVE_BYTES,
      cores: 20,
      freeRamBytes: 10282 * MB,
      resolution: undefined,
      launchLog: [],
      spawnCalls: [],
      entryPoint: 'mutation',
      pin: undefined,
    };
  }
  return ctx.bl786;
}

function resolveForState(st) {
  return resolveMutationConcurrency({
    freeRamBytes: st.freeRamBytes,
    coreCount: st.cores,
    peakRssPerWorkerBytes: st.peakBytes,
    reserveBytes: st.reserveBytes,
    pin: st.pin,
  });
}

function scriptCommandForEntryPoint(entryPoint) {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'extension', 'package.json'), 'utf8'));
  const script = pkg.scripts[entryPoint];
  assert.ok(script, `missing npm script ${entryPoint}`);
  return script;
}

function strykerArgsForEntryPoint(entryPoint) {
  const script = scriptCommandForEntryPoint(entryPoint);
  const runIdx = script.indexOf(' run -- ');
  assert.ok(runIdx !== -1, `script must use mutation-concurrency.js run --: ${script}`);
  const tail = script.slice(runIdx + ' run -- '.length);
  return tail.split(/\s+/);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the declared per-worker peak RSS is 783 MB \(821121024 bytes\)$/, (ctx) => {
    ensureState(ctx).peakBytes = 821121024;
  });

  scoped(/^the declared per-worker peak RSS is 1566 MB \(1642242048 bytes\)$/, (ctx) => {
    ensureState(ctx).peakBytes = 1642242048;
  });

  scoped(/^the declared RAM reserve is 2048 MB$/, (ctx) => {
    ensureState(ctx).reserveBytes = 2048 * MB;
  });

  scoped(/^a host with (\d+) cores and (\d+) MB of free RAM$/, (ctx, cores, freeMb) => {
    const st = ensureState(ctx);
    st.cores = Number(cores);
    st.freeRamBytes = Number(freeMb) * MB;
  });

  scoped(/^a host that resolves a concurrency of (\d+)$/, (ctx, resolved) => {
    const st = ensureState(ctx);
    st.cores = 20;
    st.freeRamBytes = 10282 * MB;
    st.peakBytes = DECLARED_PEAK_RSS_PER_WORKER_BYTES;
    const out = resolveForState(st);
    assert.equal(out.concurrency, Number(resolved));
  });

  scoped(/^"extension\/stryker\.config\.json" declares a concurrency of (\d+)$/, (ctx, value) => {
    const config = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'extension', 'stryker.config.json'), 'utf8')
    );
    assert.equal(config.concurrency, Number(value));
  });

  scoped(/^the "([^"]+)" entry point resolves its concurrency$/, (ctx, entryPoint) => {
    const st = ensureState(ctx);
    st.entryPoint = entryPoint;
    st.resolution = resolveForState(st);
  });

  scoped(/^the resolved concurrency is (\d+)$/, (ctx, expected) => {
    assert.equal(ensureState(ctx).resolution.concurrency, Number(expected));
  });

  scoped(/^the "([^"]+)" entry point launches Stryker$/, (ctx, entryPoint) => {
    const st = ensureState(ctx);
    st.entryPoint = entryPoint;
    st.resolution = resolveForState(st);
    st.launchLog = [];
    st.spawnCalls = [];
    const args = strykerArgsForEntryPoint(entryPoint);
    launchMutationCommand(st.resolution, args[0], args.slice(1), {
      spawn: (_cmd, spawnArgs) => {
        st.spawnCalls.push(spawnArgs);
        return { on: () => {} };
      },
      log: (line) => st.launchLog.push(line),
    });
  });

  scoped(
    /^the "([^"]+)" entry point launches Stryker with concurrency pinned to (\d+)$/,
    (ctx, entryPoint, pin) => {
      const st = ensureState(ctx);
      st.entryPoint = entryPoint;
      st.pin = Number(pin);
      st.resolution = resolveForState(st);
      st.launchLog = [];
      st.spawnCalls = [];
      const args = strykerArgsForEntryPoint(entryPoint);
      launchMutationCommand(st.resolution, args[0], args.slice(1), {
        spawn: (_cmd, spawnArgs) => {
          st.spawnCalls.push(spawnArgs);
          return { on: () => {} };
        },
        log: (line) => st.launchLog.push(line),
      });
    }
  );

  scoped(/^Stryker is invoked with concurrency (\d+)$/, (ctx, expected) => {
    const st = ensureState(ctx);
    assert.ok(st.spawnCalls.length > 0, 'expected a spawn call');
    const args = st.spawnCalls[st.spawnCalls.length - 1];
    const idx = args.indexOf('--concurrency');
    assert.notEqual(idx, -1, `missing --concurrency in ${JSON.stringify(args)}`);
    assert.equal(Number(args[idx + 1]), Number(expected));
  });

  scoped(/^the mutation entry points declared in "extension\/package\.json" are enumerated$/, (ctx) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'extension', 'package.json'), 'utf8'));
    ctx.bl786 = ensureState(ctx);
    ctx.bl786.enumerated = MUTATION_SCRIPT_NAMES.filter((name) => typeof pkg.scripts[name] === 'string');
    assert.deepEqual(ctx.bl786.enumerated, MUTATION_SCRIPT_NAMES);
  });

  scoped(/^each mutation entry point resolves its concurrency through the shared resolver$/, (ctx) => {
    const st = ensureState(ctx);
    for (const name of st.enumerated ?? MUTATION_SCRIPT_NAMES) {
      const script = scriptCommandForEntryPoint(name);
      assert.match(script, /mutation-concurrency\.js run --/, `${name} must use mutation-concurrency.js`);
    }
  });

  scoped(/^the run output reports the concurrency as "([^"]+)"$/, (ctx, source) => {
    const st = ensureState(ctx);
    const joined = st.launchLog.join('\n');
    assert.match(joined, new RegExp(`\\(${source}\\)`));
  });

  scoped(/^the run output reports the resolved concurrency (\d+)$/, (ctx, expected) => {
    const joined = ensureState(ctx).launchLog.join('\n');
    assert.match(joined, new RegExp(`mutation-concurrency: ${expected}`));
  });

  scoped(
    /^the run output reports the free RAM, core count, per-worker peak and reserve it was derived from$/,
    (ctx) => {
      const joined = ensureState(ctx).launchLog.join('\n');
      assert.match(joined, /free_ram_mb=/);
      assert.match(joined, /cores=/);
      assert.match(joined, /peak_rss_per_worker_mb=/);
      assert.match(joined, /reserve_mb=/);
    }
  );

  scoped(/^each mutation entry point resolves its concurrency$/, (ctx) => {
    const st = ensureState(ctx);
    st.resolutions = MUTATION_SCRIPT_NAMES.map(() => resolveForState(st));
  });

  scoped(/^each mutation entry point resolves a concurrency of (\d+)$/, (ctx, expected) => {
    const st = ensureState(ctx);
    for (const out of st.resolutions ?? []) {
      assert.equal(out.concurrency, Number(expected));
    }
  });

  scoped(/^MUTATION_CONCURRENCY env pin is documented$/, () => {
    assert.equal(MUTATION_CONCURRENCY_ENV, 'MUTATION_CONCURRENCY');
    const report = formatMutationConcurrencyReport({
      concurrency: 1,
      source: 'pinned',
      freeRamBytes: 1024 * MB,
      coreCount: 4,
      peakRssPerWorkerBytes: DECLARED_PEAK_RSS_PER_WORKER_BYTES,
      reserveBytes: DEFAULT_RESERVE_BYTES,
      pin: 1,
    });
    assert.match(report, /pinned/);
  });
}

module.exports = { registerSteps };
