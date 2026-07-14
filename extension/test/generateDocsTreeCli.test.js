const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../out/tools/generate-docs-tree');

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-docs-tree-cli-')));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

const CLI_PATH = path.join(__dirname, '..', 'out', 'tools', 'generate-docs-tree.js');

function runCliSubprocess(root, envOverrides) {
  const env = envOverrides ? { ...process.env, ...envOverrides } : undefined;
  return execFileSync('node', [CLI_PATH], { cwd: root, encoding: 'utf8', env });
}

// Runs the REAL main() in-process against a real fixture repo/env, so
// in-process coverage and mutation tooling can see the branches a
// subprocess-only smoke test cannot (mirrors notifyDeadLettersCli.test.js's
// own identical seam). main() takes no arguments - it reads process.cwd()
// (via resolveCliMainWorktreeContext) and process.env.MT_API_KEY (via
// cliSession.ts's resolveMtEngine) internally - and prints ONLY via
// printJsonToStdout (process.stdout.write), so cwd/env/stdout are the only
// state that needs faking and restoring.
async function runCli(root, envOverrides = {}) {
  const previousCwd = process.cwd();
  const previousEnv = Object.fromEntries(Object.keys(envOverrides).map((k) => [k, process.env[k]]));
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    for (const [key, value] of Object.entries(envOverrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.chdir(root);
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(previousCwd);
    for (const key of Object.keys(envOverrides)) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
  return writes.join('');
}

// BL-118: with no MT_API_KEY configured (the default in CI until the
// operator wires the secret), the translation pass still runs end to end
// via the null engine - the publish succeeds, every translatable field is
// flagged untranslated rather than the CLI crashing or silently omitting
// the *Fr fields, and the cache file is written (even though it stays
// empty, since nothing was actually translated).
test('bilingual-05: with no MT_API_KEY configured, the CLI still publishes successfully with fields flagged untranslated', async () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);

  mkdirp(path.join(root, 'backlog', 'active'));
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-901.yaml'),
    'id: BL-901\ntitle: untranslated title\nstatus: active\nmilestone: M1\nacceptance: |\n  # BL-901 x-01\n  Scenario: works\n    Given a\n'
  );
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`
  );

  const output = await runCli(root, { MT_API_KEY: '' });

  const data = JSON.parse(output);
  const ticket = data.tickets.find((t) => t.id === 'BL-901');
  assert.equal(ticket.titleFr, 'untranslated title');
  assert.equal(ticket.titleFrUntranslated, true);
  assert.ok(fs.existsSync(path.join(root, 'docs', 'i18n', 'translation-cache.json')), 'the cache file must be written even when empty');
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process test above, never the only cover for the real logic.
// BL-117 docs-drilldown-01/03: the compiled generator prints ONLY valid
// JSON to stdout, resolving both acceptance forms, no NaN/Infinity/
// undefined leaking through.
test('the compiled CLI runs standalone as a subprocess and prints a valid, schema-versioned docs-tree.json to stdout', () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);

  mkdirp(path.join(root, 'backlog', 'active'));
  mkdirp(path.join(root, 'docs', 'diagrams'));
  fs.writeFileSync(path.join(root, 'docs', 'Specification.MD'), '# Spec');
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-900.yaml'),
    'id: BL-900\ntitle: t\nstatus: active\nmilestone: M1\ndescription: |\n  Some prose.\nacceptance: |\n  Scenario: works\n    Given a\n'
  );
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);

  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'roles.tsv'),
    `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`
  );

  const output = runCliSubprocess(root);

  assert.doesNotMatch(output, /NaN|Infinity|undefined/);
  const data = JSON.parse(output);
  assert.equal(typeof data.schemaVersion, 'number');
  assert.ok(data.sourceSha);
  assert.equal(data.vision.find((v) => v.id === 'specification').content, '# Spec');
  const ticket = data.tickets.find((t) => t.id === 'BL-900');
  assert.equal(ticket.description, 'Some prose.');
  assert.equal(ticket.scenarios.length, 1);
  assert.equal(ticket.scenarios[0].name, 'works');
});
