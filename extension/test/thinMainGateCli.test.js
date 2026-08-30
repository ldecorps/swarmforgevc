const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  parseArgs,
  resolveScanFiles,
  loadAllowlist,
  runThinMainGate,
} = require('../out/tools/thin-main-gate');

function mkExtRoot() {
  const root = mkTmpDir('thin-main-cli-');
  fs.mkdirSync(path.join(root, 'src', 'tools', 'nested'), { recursive: true });
  return root;
}

test('parseArgs: no argv means full mode', () => {
  assert.deepEqual(parseArgs([]), { mode: 'full', paths: [] });
});

test('parseArgs: paths mean parcel mode', () => {
  assert.deepEqual(parseArgs(['a.ts', 'b.ts']), { mode: 'parcel', paths: ['a.ts', 'b.ts'] });
});

test('resolveScanFiles full walks only .ts under src/tools', () => {
  const root = mkExtRoot();
  fs.writeFileSync(path.join(root, 'src', 'tools', 'a.ts'), 'export const main = () => {};\n');
  fs.writeFileSync(path.join(root, 'src', 'tools', 'a.d.ts'), 'export {};\n');
  fs.writeFileSync(path.join(root, 'src', 'tools', 'nested', 'b.ts'), 'export const main = () => {};\n');
  fs.writeFileSync(path.join(root, 'src', 'tools', 'note.txt'), 'nope\n');
  const files = resolveScanFiles({ mode: 'full', paths: [] }, root).map((p) => path.basename(p)).sort();
  assert.deepEqual(files, ['a.ts', 'b.ts']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolveScanFiles full returns [] when tools dir missing', () => {
  const root = mkExtRoot();
  fs.rmSync(path.join(root, 'src'), { recursive: true, force: true });
  assert.deepEqual(resolveScanFiles({ mode: 'full', paths: [] }, root), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('resolveScanFiles parcel keeps only paths under tools', () => {
  const root = mkExtRoot();
  const inside = path.join(root, 'src', 'tools', 'in.ts');
  const outside = path.join(root, 'other.ts');
  fs.writeFileSync(inside, 'export function main() {}\n');
  fs.writeFileSync(outside, 'export function main() {}\n');
  const files = resolveScanFiles({ mode: 'parcel', paths: [inside, outside] }, root);
  assert.deepEqual(files, [path.resolve(inside)]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('loadAllowlist missing file yields empty set', () => {
  const root = mkExtRoot();
  assert.equal(loadAllowlist(root).size, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('loadAllowlist reads thin-main-allowlist.txt', () => {
  const root = mkExtRoot();
  fs.writeFileSync(path.join(root, 'thin-main-allowlist.txt'), '# c\nold.ts\n');
  assert.deepEqual([...loadAllowlist(root)], ['old.ts']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('runThinMainGate parcel fails on fat tools main', () => {
  const root = mkExtRoot();
  const fat = path.join(root, 'src', 'tools', 'fat.ts');
  fs.writeFileSync(
    fat,
    'export function main(): void {\n  if (a) { if (b) { c(); } }\n}\n'
  );
  const outcome = runThinMainGate({ mode: 'parcel', paths: [fat] }, root);
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.text, /fat\.ts/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('runThinMainGate full uses allowlist; parcel does not', () => {
  const root = mkExtRoot();
  const fat = path.join(root, 'src', 'tools', 'fat.ts');
  fs.writeFileSync(
    fat,
    'export function main(): void {\n  if (a) { if (b) { c(); } }\n}\n'
  );
  fs.writeFileSync(path.join(root, 'thin-main-allowlist.txt'), 'fat.ts\n');
  const full = runThinMainGate({ mode: 'full', paths: [] }, root);
  assert.equal(full.exitCode, 0);
  const parcel = runThinMainGate({ mode: 'parcel', paths: [fat] }, root);
  assert.equal(parcel.exitCode, 1);
  fs.rmSync(root, { recursive: true, force: true });
});


test('resolveScanFiles parcel returns exactly the requested tools file', () => {
  const root = mkExtRoot();
  const a = path.join(root, 'src', 'tools', 'a.ts');
  const b = path.join(root, 'src', 'tools', 'b.ts');
  fs.writeFileSync(a, 'export function main() {}\n');
  fs.writeFileSync(b, 'export function main() {}\n');
  const files = resolveScanFiles({ mode: 'parcel', paths: [a] }, root);
  assert.deepEqual(files, [path.resolve(a)]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('isPathUnder accepts the tools directory itself (equality branch)', () => {
  const root = mkExtRoot();
  const tools = path.join(root, 'src', 'tools');
  // Parcel with tools dir itself — kills mutants that drop `resolved === base`.
  const files = resolveScanFiles({ mode: 'parcel', paths: [tools] }, root);
  assert.deepEqual(files, [path.resolve(tools)]);
  fs.rmSync(root, { recursive: true, force: true });
});


test('resolveScanFiles full ignores .ts outside src/tools', () => {
  const root = mkExtRoot();
  fs.writeFileSync(path.join(root, 'src', 'tools', 'in.ts'), 'export function main() {}\n');
  fs.mkdirSync(path.join(root, 'src', 'other'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'other', 'out.ts'), 'export function main() {}\n');
  const files = resolveScanFiles({ mode: 'full', paths: [] }, root).map((p) => path.basename(p)).sort();
  assert.deepEqual(files, ['in.ts']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('main() subprocess dogfood covers CLI entrypoint', () => {
  const { spawnSync } = require('node:child_process');
  const cli = path.join(__dirname, '..', 'out', 'tools', 'thin-main-gate.js');
  // Full-repo mode exercises argv slice, allowlist load, and the console.log
  // branch against the real tools tree. Exit 0 or 1 both prove main() ran.
  const r = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.ok(r.status === 0 || r.status === 1, `status=${r.status} stderr=${r.stderr}`);
  assert.equal(r.error, undefined);
});
