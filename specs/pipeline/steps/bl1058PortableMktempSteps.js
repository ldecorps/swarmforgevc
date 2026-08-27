'use strict';

// BL-1058: step handlers for "the tmp-cleanup helper initializes under either
// mktemp dialect".
//
// Every scenario runs the REAL swarmforge/scripts/test/lib/tmp_cleanup.sh as a
// subprocess under `set -euo pipefail` and then reads the filesystem. Nothing
// here simulates sourcing, and nothing asserts over the helper's TEXT - the
// registry file exists or it does not, the fixture root is gone or it is not.
//
// The dialect seam is a mktemp shim first on PATH, written by the very script
// the unit suite sources (lib/mktemp_dialect_shim.sh). Driving one shim
// implementation from both lanes is deliberate: two copies could drift into
// modelling different userlands, and the lane that mattered would be the one
// that drifted. The shim creates files itself rather than delegating, so the
// host's own mktemp cannot rescue a call the modelled userland would refuse.
//
// Non-vacuity was checked by authoring: restoring `mktemp -t <prefix>` in the
// helper fails scenario 01's GNU row, and a GNU-only `mktemp --tmpdir ...`
// fails its BSD row. Neither arm passes for both.
//
// Invariant (BL-968): module load is requires and pure constants only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach } = require('node:test');

const FEATURE = 'The tmp-cleanup helper initializes under either mktemp dialect';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test');
const HELPER = path.join(TEST_DIR, 'lib', 'tmp_cleanup.sh');
const SHIM_WRITER = path.join(TEST_DIR, 'lib', 'mktemp_dialect_shim.sh');

// Explicit known values per the Scenario Outline handler rule: a row the
// handlers do not know is a hard failure, never a passthrough. The feature
// names the userlands in caps; the shim writer takes its own lowercase names.
const KNOWN_DIALECTS = new Map([['GNU', 'gnu'], ['BSD', 'bsd']]);
const KNOWN_SITES = new Set(['directly', 'from inside a command substitution']);
const KNOWN_ENDINGS = new Set(['reaches its end cleanly', 'exits on a failed command']);

const REFUSING = 'refuses-everything';

let trackedPaths = [];
afterEach(() => {
  while (trackedPaths.length) {
    fs.rmSync(trackedPaths.pop(), { recursive: true, force: true });
  }
});

// A sandbox per scenario: its own bin/ for the shim and its own tmp/ for
// TMPDIR, so the registry and every fixture root land somewhere this file's
// own afterEach reclaims - never the shared system temp root.
function newSandbox(dialect) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1058-'));
  trackedPaths.push(root);
  const bin = path.join(root, 'bin');
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(bin);
  fs.mkdirSync(tmp);
  const written = spawnSync('bash', [SHIM_WRITER, bin, dialect], { encoding: 'utf8' });
  assert.equal(written.status, 0,
    `could not write the ${dialect} mktemp shim: ${written.stdout}${written.stderr}`);
  assert.ok(fs.existsSync(path.join(bin, 'mktemp')),
    `the ${dialect} mktemp shim was not created under ${bin}`);
  return { root, bin, tmp };
}

// Runs a bash body with ONLY the shim's mktemp reachable ahead of the host's.
// The registry variable is unset so an exported one from whatever runs this
// suite cannot short-circuit the very guard under test.
function runUnderDialect(ctx, body) {
  const env = { ...process.env, PATH: `${ctx.sandbox.bin}:${process.env.PATH}`, TMPDIR: ctx.sandbox.tmp };
  delete env.__SWARMFORGE_TMP_CLEANUP_REGISTRY;
  const res = spawnSync('bash', ['-c', body], { encoding: 'utf8', env });
  ctx.exit = res.status;
  ctx.output = `${res.stdout || ''}${res.stderr || ''}`;
}

function readField(output, name) {
  const match = new RegExp(`^${name}=(.*)$`, 'm').exec(output);
  return match ? match[1] : '';
}

// The fixture's own scaffolding uses the one call form BOTH userlands accept,
// so it can never be the thing that decides which dialect row passes.
const MAKE_ROOT = 'mktemp -d "$TMPDIR/bl1058-root.XXXXXX"';

function fixtureScript(site, ending) {
  const register = site === 'directly'
    ? [`ROOT="$(${MAKE_ROOT})"`, 'register_tmp_dir "$ROOT"']
    : [
      `make_root() { local d; d="$(${MAKE_ROOT})"; register_tmp_dir "$d"; printf '%s' "$d"; }`,
      'ROOT="$(make_root)"',
    ];
  return [
    'set -euo pipefail',
    `source ${JSON.stringify(HELPER)}`,
    ...register,
    'echo "ROOT=$ROOT"',
    ending === 'exits on a failed command' ? 'false' : 'true',
  ].join('\n');
}

// The registry is reported from INSIDE the still-running script, existence
// included. The helper's EXIT trap removes the registry as it is designed to,
// so a check made after the subprocess has exited would report "missing" for a
// perfectly healthy helper - and would keep reporting it however the call was
// written, which is a scenario that can never pass.
const SOURCE_ONLY = [
  'set -euo pipefail',
  `source ${JSON.stringify(HELPER)}`,
  'printf \'REGISTRY=%s\\n\' "$__SWARMFORGE_TMP_CLEANUP_REGISTRY"',
  '[[ -f "$__SWARMFORGE_TMP_CLEANUP_REGISTRY" ]] && echo REGISTRY_EXISTS=yes || echo REGISTRY_EXISTS=no',
  'echo REACHED_BODY',
].join('\n');

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // Background. The helper's whole failure mode is that a dying command
  // substitution under `set -e` kills the sourcing script before any test body
  // runs, so this is a real precondition of every scenario, not decoration -
  // both fixture bodies below open with it.
  scoped(/^a script running under set -euo pipefail$/, (ctx) => {
    assert.ok(fs.existsSync(HELPER), `the helper under test is missing: ${HELPER}`);
    assert.ok(fs.existsSync(SHIM_WRITER), `the mktemp shim writer is missing: ${SHIM_WRITER}`);
    ctx.strict = true;
  });

  scoped(/^a mktemp on PATH that accepts only "(.+)" template syntax$/, (ctx, dialect) => {
    assert.ok(KNOWN_DIALECTS.has(dialect),
      `unknown dialect "${dialect}" - the handlers know ${[...KNOWN_DIALECTS.keys()].join(', ')}`);
    ctx.sandbox = newSandbox(KNOWN_DIALECTS.get(dialect));
  });

  scoped(/^a mktemp on PATH that fails for every invocation$/, (ctx) => {
    ctx.sandbox = newSandbox(REFUSING);
  });

  // Fires as a `When` in scenarios 01 and 03 and as a `Given` continuation in
  // 02. Sourcing on its own is a complete, observable act - it either yields a
  // usable registry or dies - so it runs here in every case; scenario 02's
  // ending step then runs the fuller fixture that also registers a root.
  scoped(/^the script sources the tmp-cleanup helper$/, (ctx) => {
    assert.ok(ctx.strict, 'the background never established a strict-mode script');
    assert.ok(ctx.sandbox, 'no mktemp dialect was put on PATH before sourcing');
    runUnderDialect(ctx, SOURCE_ONLY);
    ctx.registry = readField(ctx.output, 'REGISTRY');
  });

  scoped(/^the script registers a fixture root (.+)$/, (ctx, site) => {
    assert.ok(KNOWN_SITES.has(site),
      `unknown registration site "${site}" - the handlers know ${[...KNOWN_SITES].join(', ')}`);
    ctx.site = site;
  });

  scoped(/^the script "(.+)"$/, (ctx, ending) => {
    assert.ok(KNOWN_ENDINGS.has(ending),
      `unknown ending "${ending}" - the handlers know ${[...KNOWN_ENDINGS].join(', ')}`);
    assert.ok(ctx.site, 'no registration site was chosen before the script ended');
    ctx.ending = ending;
    runUnderDialect(ctx, fixtureScript(ctx.site, ending));
    ctx.root = readField(ctx.output, 'ROOT');
    assert.ok(ctx.root, `the fixture never printed a registered root: ${ctx.output}`);
    // The ending itself must be real: a "failed command" row that exits 0
    // would prove nothing about the failing path.
    if (ending === 'exits on a failed command') {
      assert.notEqual(ctx.exit, 0, `a fixture ending on a failed command exited 0: ${ctx.output}`);
    } else {
      assert.equal(ctx.exit, 0, `a cleanly ending fixture exited ${ctx.exit}: ${ctx.output}`);
    }
  });

  scoped(/^the helper exposes a registry file that exists$/, (ctx) => {
    assert.equal(ctx.exit, 0, `sourcing the helper exited ${ctx.exit}: ${ctx.output}`);
    assert.ok(ctx.registry, `the helper exposed no registry path: ${ctx.output}`);
    assert.equal(readField(ctx.output, 'REGISTRY_EXISTS'), 'yes',
      `the helper named a registry that does not exist: ${ctx.registry}`);
    // BSD's -t honoured TMPDIR, so dropping the flag must not silently
    // relocate anyone's fixtures.
    assert.ok(ctx.registry.startsWith(`${ctx.sandbox.tmp}/`),
      `the registry landed outside TMPDIR (${ctx.sandbox.tmp}): ${ctx.registry}`);
  });

  scoped(/^the fixture root no longer exists$/, (ctx) => {
    assert.ok(!fs.existsSync(ctx.root), `the registered fixture root survived: ${ctx.root}`);
  });

  scoped(/^the script exits non-zero$/, (ctx) => {
    assert.notEqual(ctx.exit, 0,
      `sourcing succeeded with an mktemp that refuses every invocation: ${ctx.output}`);
    assert.ok(!/REACHED_BODY/.test(ctx.output),
      `the script kept running past a registry it could not create: ${ctx.output}`);
  });

  scoped(/^the error names the tmp-cleanup registry as what could not be created$/, (ctx) => {
    // `set -u` used to surface this as an unbound-variable error somewhere
    // else entirely, which named neither the helper nor the registry.
    assert.ok(!/unbound variable/i.test(ctx.output),
      `the failure surfaced as an unbound-variable error instead of a named one: ${ctx.output}`);
    assert.match(ctx.output, /tmp-cleanup registry/i,
      `the error never names the tmp-cleanup registry: ${ctx.output}`);
  });
}

module.exports = { registerSteps };
