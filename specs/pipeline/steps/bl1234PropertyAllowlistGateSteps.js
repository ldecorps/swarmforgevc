'use strict';

// BL-1234: the property-suite standing-red allowlist gate must recognise
// EVERY allowlisted failing file, not just a lone one - a missing newline
// in ps_allowlist_normalize_file concatenated 2+ normalized paths onto one
// line before sort -u saw them, so the gate refused every commit whenever
// 2+ allowlisted tests were red (the only case that occurs in practice
// once the allowlist names more than one file).
//
// Drives the REAL swarmforge/scripts/property_suite_standing_allowlist_lib.sh
// (ps_suite_failures_all_allowlisted) against a real, self-contained fixture
// TSV - never a JS reimplementation of the bash parsing/allowlist logic.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'property_suite_standing_allowlist_lib.sh');

const FEATURE_NAME = 'the property-suite allowlist gate recognises every allowlisted red, not just a lone one';

const COUNT_WORDS = { one: 1, two: 2, five: 5 };

const FIXTURE_PREFIX = 'bl1234-allowlist-';

// BL-971: sweep stale fixture dirs by prefix BEFORE the run too - a killed
// prior run traps nothing in its own finally.
function sweepStaleFixtures() {
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
    }
  }
}

function buildTsv(root, files) {
  const tsvPath = path.join(root, 'allowlist.tsv');
  const lines = ['file\tdisposition\trationale', ...files.map((f) => `${f}\tallowlist\tfixture`)];
  fs.writeFileSync(tsvPath, lines.join('\n') + '\n');
  return tsvPath;
}

function fakeFailOutput(files) {
  return files.map((f) => ` FAIL  ${f} > some/failure/detail`).join('\n');
}

function evaluateGuard(tsvPath, failOutput) {
  // failOutput is passed via an environment variable, never interpolated
  // into the script text: JSON.stringify (or any shell-quoting scheme
  // built on a JS template literal) turns real newlines into the literal
  // two-character sequence "\n", which a double-quoted bash string does
  // NOT expand back into a line break - the multi-file parsing this
  // ticket exists to fix depends on genuine newlines between FAIL lines,
  // exactly like the real subprocess output check_property_suite_drift.sh
  // captures via `$(...)`.
  const script = `
set -euo pipefail
source ${JSON.stringify(LIB)}
set +e
UNLISTED="$(ps_suite_failures_all_allowlisted ${JSON.stringify(tsvPath)} "$FAKE_FAIL_OUTPUT")"
STATUS=$?
set -e
printf '%s\\n' "$STATUS"
printf '%s' "$UNLISTED"
`;
  const res = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, FAKE_FAIL_OUTPUT: failOutput },
  });
  if (res.status !== 0 && res.stderr) {
    // bash -c itself always exits 0 here (the guard's own status is
    // captured internally); a non-zero bash exit means the fixture script
    // itself broke, which is a test-authoring bug, not a scenario outcome.
    throw new Error(`fixture script failed: ${res.stderr}`);
  }
  const lines = res.stdout.split('\n');
  const status = Number(lines[0]);
  const unlisted = lines.slice(1).join('\n');
  return { status, unlisted };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE_NAME);

  scoped(/^a property suite run that failed$/, (ctx) => {
    sweepStaleFixtures();
    ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  });

  scoped(/^a standing-red allowlist naming files by path$/, () => {
    // Vocabulary-only; the TSV is built per-scenario below with the exact
    // files each scenario needs.
  });

  scoped(/^(one|two|five) failing files, every one of them named in the allowlist$/, (ctx, word) => {
    const count = COUNT_WORDS[word];
    const files = Array.from({ length: count }, (_, i) => `test/bl1234Fixture${i}.property.test.js`);
    ctx.tsvPath = buildTsv(ctx.root, files);
    ctx.failOutput = fakeFailOutput(files);
  });

  scoped(/^three failing files, two named in the allowlist and one not$/, (ctx) => {
    const allowlisted = ['test/bl1234FixtureA.property.test.js', 'test/bl1234FixtureB.property.test.js'];
    const unlisted = 'test/bl1234FixtureUNLISTED.property.test.js';
    ctx.tsvPath = buildTsv(ctx.root, allowlisted);
    ctx.failOutput = fakeFailOutput([allowlisted[0], unlisted, allowlisted[1]]);
    ctx.expectedUnlisted = unlisted;
  });

  scoped(/^the property-suite guard evaluates the run$/, (ctx) => {
    ctx.result = evaluateGuard(ctx.tsvPath, ctx.failOutput);
  });

  scoped(/^the commit is allowed$/, (ctx) => {
    try {
      if (ctx.result.status !== 0) {
        throw new Error(`expected the commit to be allowed, guard exited ${ctx.result.status}: ${ctx.result.unlisted}`);
      }
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });

  scoped(/^the commit is refused$/, (ctx) => {
    if (ctx.result.status === 0) {
      throw new Error(`expected the commit to be refused, guard exited 0`);
    }
  });

  scoped(/^the refusal names the unlisted file and no other path$/, (ctx) => {
    try {
      const lines = ctx.result.unlisted.split('\n').filter(Boolean);
      if (lines.length !== 1 || lines[0] !== ctx.expectedUnlisted) {
        throw new Error(
          `expected the refusal to name exactly ["${ctx.expectedUnlisted}"], got: ${JSON.stringify(lines)}`,
        );
      }
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
