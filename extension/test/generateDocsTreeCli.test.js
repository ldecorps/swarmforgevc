const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function mkTmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-docs-tree-cli-')));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

// BL-117 docs-drilldown-01/03: the compiled generator prints ONLY valid
// JSON to stdout, resolving both acceptance forms, no NaN/Infinity/
// undefined leaking through.
test('the compiled generator prints a valid, schema-versioned docs-tree.json to stdout', () => {
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

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'generate-docs-tree.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8' });

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

// BL-118: with no MT_API_KEY configured (the default in CI until the
// operator wires the secret), the translation pass still runs end to end
// via the null engine - the publish succeeds, every translatable field is
// flagged untranslated rather than the CLI crashing or silently omitting
// the *Fr fields, and the cache file is written (even though it stays
// empty, since nothing was actually translated).
test('bilingual-05: with no MT_API_KEY configured, the CLI still publishes successfully with fields flagged untranslated', () => {
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

  const cliPath = path.join(__dirname, '..', 'out', 'tools', 'generate-docs-tree.js');
  const output = execFileSync('node', [cliPath], { cwd: root, encoding: 'utf8', env: { ...process.env, MT_API_KEY: '' } });

  const data = JSON.parse(output);
  const ticket = data.tickets.find((t) => t.id === 'BL-901');
  assert.equal(ticket.titleFr, 'untranslated title');
  assert.equal(ticket.titleFrUntranslated, true);
  assert.ok(fs.existsSync(path.join(root, 'docs', 'i18n', 'translation-cache.json')), 'the cache file must be written even when empty');
});
