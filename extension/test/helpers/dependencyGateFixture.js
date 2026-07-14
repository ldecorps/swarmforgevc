const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// BL-375: shared fixture helpers for the dependencyGateCli* split - extracted
// so the file boundary that lets these real-engine tests run concurrently
// (one file = one Vitest worker) doesn't cost a copy-pasted setup in each
// sibling file. No dependency-cruiser mocking lives here or anywhere in the
// split: every file still shells the REAL pinned checker (BL-259's own
// constraint) against a REAL, isolated fixture tree this module builds.

const REAL_CONFIG_PATH = path.join(__dirname, '..', '..', '.dependency-cruiser.cjs');

function mkFixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-depgate-fixture-'));
}

function writeFixtureTsconfig(root) {
  // allowJs: a fixture that carries ONLY .js files (e.g. a media/-only
  // fixture with no .ts anywhere) otherwise leaves tsc's own `include`
  // resolution empty (TS18003), since tsc excludes .js from `include` by
  // default - the real project's own tsconfig.json never hits this because
  // src/**/*.ts always has plenty of real .ts files alongside media/.
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { module: 'commonjs', target: 'ES2022', allowJs: true }, include: ['src/**/*', 'media/**/*'] })
  );
}

function writeFile(root, relPath, content) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

module.exports = { REAL_CONFIG_PATH, mkFixtureRoot, writeFixtureTsconfig, writeFile };
