'use strict';

// BL-937: step handlers for "every tracked shell script runs on the stock
// macOS /bin/bash 3.2 this repo targets". Drives the REAL /bin/bash and the
// real scripts - never a reimplementation of any of them. Scenario 01
// exercises the three previously-mapfile-blocked handoffd wiring tests
// directly; Scenario 02 is a pure static scan over tracked shell scripts
// with comment lines excluded (deliberately includes the fix's OWN
// explanatory comments in that exclusion - they mention "mapfile" and
// "readarray" in prose and would otherwise self-trip the scan); Scenario 03
// drives the two operator scripts against disposable fixtures.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'every tracked shell script runs on the stock macOS /bin/bash 3.2 this repo targets';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'swarmforge', 'scripts');

function cleanupFixture(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  }
}

function guarded(fn) {
  return (ctx, ...args) => {
    try {
      return fn(ctx, ...args);
    } catch (err) {
      cleanupFixture(ctx);
      throw err;
    }
  };
}

function terminal(fn) {
  return (ctx, ...args) => {
    try {
      return fn(ctx, ...args);
    } finally {
      cleanupFixture(ctx);
    }
  };
}

// ── Scenario 01: the three handoffd wiring tests ─────────────────────────

const WIRING_TEST_VALUES = new Set([
  'test_handoffd_priority_rotate_wiring.sh',
  'test_handoffd_aged_note_rotate_wiring.sh',
  'test_handoffd_starve_rotate_wiring.sh',
]);

function parseKnown(set, token, label) {
  if (!set.has(token)) {
    throw new Error(`unknown ${label} token: ${token}`);
  }
  return token;
}

// ── Scenario 02: the static construct scan ───────────────────────────────

function trackedShellScripts() {
  const out = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '--', '*.sh'], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .map((rel) => path.join(REPO_ROOT, rel));
}

// Excludes comment lines (first non-whitespace char '#') before scanning -
// this fix's OWN explanatory comments name "mapfile"/"readarray" in prose,
// same shape as lifecycle_matrix.sh's pre-existing "no `declare -A`"
// comment; a scan that read comments would trip on both.
function stripComments(content) {
  return content
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

const CONSTRUCT_REGEXES = {
  'mapfile or readarray': /\b(?:mapfile|readarray)\b/,
  'case-converting parameter expansion': /\$\{\w+(?:\^\^|\^|,,|,)\}/,
};

// swarmforge/scripts/test/test_route_backlog_role_label_bash32.sh's own
// scenario 03 embeds the literal string `${ROLE^}` as TEST DATA inside a
// single-quoted `bash -c '...'` argument, specifically to prove /bin/bash
// 3.x REJECTS it (a pre-existing, already-fixed regression test for
// route_backlog_to_coder.sh's own prior bash-4 usage - read the file, its
// own scenario 01 runs an equivalent scan against JUST that one script).
// The outer script here never evaluates that string itself; it hands it to
// a nested subprocess as a controlled negative case. Excluding this one
// known, well-justified occurrence rather than weakening the general regex
// - the same "known-good, do not trip on it" posture the ticket itself
// applies to lifecycle_matrix.sh's comment, just for a non-comment case
// the comment-stripping filter alone cannot distinguish.
const KNOWN_SAFE_OCCURRENCES = new Set(['swarmforge/scripts/test/test_route_backlog_role_label_bash32.sh']);

// ── Scenario 03: the two operator scripts ────────────────────────────────

const OPERATOR_SCRIPT_VALUES = new Set(['swarm_dashboard.sh', 'reexpedite_from_wip.sh']);
const OPERATOR_ARGS_VALUES = new Set(['a fixture root whose swarm has no sessions', 'a fixture root and a lower-case ticket id']);
const OPERATOR_OBSERVABLE_VALUES = new Set(['the no-live-sessions diagnostic', 'the ticket id accepted in upper case']);

function mkDashboardFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl937-dash-'));
  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(root, '.swarmforge', 'tmux-socket'), path.join(os.tmpdir(), 'sfvc-bl937-dead.sock'));
  return root;
}

function mkReexpediteFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl937-reexp-'));
  execFileSync('git', ['-C', root, '-c', 'init.defaultBranch=main', 'init', '-q']);
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  return root;
}

function registerSteps(registry) {
  // ── Scenario 01 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the stock system bash reports version 3\.2$/,
    () => {
      const result = spawnSync('/bin/bash', ['--version'], { encoding: 'utf8' });
      assert.match(result.stdout, /version 3\.2/, `expected /bin/bash --version to report 3.2, got: ${result.stdout}`);
    },
    FEATURE
  );

  registry.defineScoped(
    /^(test_handoffd_\S+\.sh) is run under it$/,
    (ctx, token) => {
      const name = parseKnown(WIRING_TEST_VALUES, token, 'wiring test script');
      const result = spawnSync('/bin/bash', [path.join(SCRIPTS, 'test', name)], { encoding: 'utf8', timeout: 100000 });
      ctx.wiringResult = { name, status: result.status, out: (result.stdout || '') + (result.stderr || '') };
    },
    FEATURE
  );

  registry.defineScoped(
    /^it runs its own scenarios to completion$/,
    (ctx) => {
      assert.doesNotMatch(
        ctx.wiringResult.out,
        /command not found|bad substitution/i,
        `expected ${ctx.wiringResult.name} to reach its own logic, not die on an unsupported bash construct: ${ctx.wiringResult.out}`
      );
    },
    FEATURE
  );

  registry.defineScoped(
    /^it reports every scenario passing$/,
    (ctx) => {
      assert.match(
        ctx.wiringResult.out,
        new RegExp(`ALL PASS: ${ctx.wiringResult.name}`),
        `expected ${ctx.wiringResult.name} to report ALL PASS, got: ${ctx.wiringResult.out}`
      );
    },
    FEATURE
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^the repo's tracked shell scripts with comment lines excluded$/,
    (ctx) => {
      ctx.scannedFiles = trackedShellScripts().map((file) => ({
        file,
        content: stripComments(fs.readFileSync(file, 'utf8')),
      }));
    },
    FEATURE
  );

  registry.defineScoped(
    /^they are scanned for (.+)$/,
    (ctx, token) => {
      const regex = CONSTRUCT_REGEXES[token];
      if (!regex) {
        throw new Error(`unknown construct token: ${token}`);
      }
      ctx.hits = ctx.scannedFiles
        .filter(({ content }) => regex.test(content))
        .map(({ file }) => path.relative(REPO_ROOT, file))
        .filter((rel) => !KNOWN_SAFE_OCCURRENCES.has(rel));
    },
    FEATURE
  );

  registry.defineScoped(
    /^no occurrence is found$/,
    (ctx) => {
      assert.deepEqual(ctx.hits, [], `expected no tracked shell script to contain this construct outside comments, found: ${JSON.stringify(ctx.hits)}`);
    },
    FEATURE
  );

  // ── Scenario 03 ──────────────────────────────────────────────────────
  registry.defineScoped(
    /^(\S+\.sh) is invoked with (.+)$/,
    guarded((ctx, scriptToken, argsToken) => {
      const script = parseKnown(OPERATOR_SCRIPT_VALUES, scriptToken, 'operator script');
      parseKnown(OPERATOR_ARGS_VALUES, argsToken, 'operator arguments');
      if (script === 'swarm_dashboard.sh') {
        ctx.root = mkDashboardFixture();
        const result = spawnSync('/bin/bash', [path.join(SCRIPTS, 'swarm_dashboard.sh'), ctx.root], { encoding: 'utf8' });
        ctx.result = { script, status: result.status, out: (result.stdout || '') + (result.stderr || '') };
      } else {
        ctx.root = mkReexpediteFixture();
        const result = spawnSync('/bin/bash', [path.join(SCRIPTS, 'reexpedite_from_wip.sh'), ctx.root, 'bl-000'], {
          encoding: 'utf8',
          env: { ...process.env, REEXPEDITE_DRY_RUN: '1' },
        });
        ctx.result = { script, status: result.status, out: (result.stdout || '') + (result.stderr || '') };
      }
    }),
    FEATURE
  );

  registry.defineScoped(
    /^no unsupported-construct error is reported$/,
    guarded((ctx) => {
      assert.doesNotMatch(ctx.result.out, /command not found|bad substitution/i, `unexpected unsupported-construct error: ${ctx.result.out}`);
    }),
    FEATURE
  );

  registry.defineScoped(
    /^(.+) is reached$/,
    terminal((ctx, token) => {
      const observable = parseKnown(OPERATOR_OBSERVABLE_VALUES, token, 'observable');
      if (observable === 'the no-live-sessions diagnostic') {
        assert.match(ctx.result.out, /no swarmforge-\* sessions live/, `expected the no-live-sessions diagnostic, got: ${ctx.result.out}`);
        assert.equal(ctx.result.status, 1);
      } else {
        assert.match(ctx.result.out, /BL-000/, `expected the ticket id normalised to BL-000, got: ${ctx.result.out}`);
      }
    }),
    FEATURE
  );
}

module.exports = { registerSteps };
