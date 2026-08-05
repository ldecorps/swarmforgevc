'use strict';

// BL-803: step handlers for "promote-and-route survives BSD sed hosts".
// Drives the REAL promote_and_route_next.sh against a real fixture git repo
// (same "drive the real script" pattern as bl663PromotionGatesSteps.js and
// test_promote_and_route_next_priority.sh), with route_backlog_to_coder.sh
// stubbed to a data-only ROUTE_LOG write (no live tmux/handoffd — the
// testability boundary this project draws around pty/tmux interaction).
//
// The two <sed_flavor> Examples are proven by prepending a fake `sed`
// binary onto PATH: `-i` fails BSD-style (mirrors the real macOS/BSD sed
// error this ticket reproduces — see the baseline failure this fixture was
// modeled on) or succeeds GNU-style, while a plain (non -i) invocation
// always delegates to the real system sed for genuine substitution. The
// fix under test never calls `-i` at all, so both flavors exercise the
// same fixed code path — proving correctness no longer depends on which
// sed flavor happens to be on PATH.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const PROMOTE_SCRIPT_SRC = path.join(SCRIPTS_DIR, 'promote_and_route_next.sh');
const GATES_CLI_SRC = path.join(SCRIPTS_DIR, 'promotion_gates_cli.bb');
const GATES_LIB_SRC = path.join(SCRIPTS_DIR, 'promotion_gates_lib.bb');

const FEATURE_NAME = 'promote-and-route survives BSD sed hosts';
const TICKET_ID = 'BL-9803';
const REAL_SED = '/usr/bin/sed';

// BL-421/engineering.prompt Scenario Outline rule: every Examples: column
// value must be validated against an explicit KNOWN_VALUES lookup, never a
// bare passthrough. Each entry is the fake `sed` script body for that flavor.
const KNOWN_SED_FLAVORS = new Map([
  [
    'bsd',
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '# Real BSD/macOS sed: -i requires a following suffix operand (even',
      '# empty) before the script argument. Given none, the script string is',
      '# consumed as the suffix and the file is queried as if it were the sed',
      '# script -- the exact failure this ticket reproduces.',
      'if [[ "${1:-}" == "-i" ]]; then',
      '  echo "sed: 1: \\"${3:-}\\": invalid command code" >&2',
      '  exit 1',
      'fi',
      `exec ${REAL_SED} "$@"`,
      '',
    ].join('\n'),
  ],
  [
    'gnu',
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '# Real GNU sed: -i takes no separate suffix operand; the very next',
      '# argument is the script, and the edit happens in place with no',
      '# backup.',
      'if [[ "${1:-}" == "-i" ]]; then',
      '  expr="$2"',
      '  file="$3"',
      '  tmp="$(mktemp)"',
      `  ${REAL_SED} "\$expr" "\$file" > "\$tmp"`,
      '  cat "$tmp" > "$file"',
      '  rm -f "$tmp"',
      '  exit 0',
      'fi',
      `exec ${REAL_SED} "$@"`,
      '',
    ].join('\n'),
  ],
]);

function fakeSedDir(flavor) {
  const body = KNOWN_SED_FLAVORS.get(flavor);
  if (!body) {
    throw new Error(`BL-803: unrecognized sed_flavor "${flavor}"`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bl803-sed-${flavor}-`));
  const stub = path.join(dir, 'sed');
  fs.writeFileSync(stub, body);
  fs.chmodSync(stub, 0o755);
  return dir;
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function initFixture(ctx) {
  if (ctx.root) {
    return;
  }
  ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl803-promote-route-'));
  git(ctx.root, ['init', '-q']);
  git(ctx.root, ['config', 'user.email', 't@t']);
  git(ctx.root, ['config', 'user.name', 't']);
  git(ctx.root, ['commit', '-q', '--allow-empty', '-m', 'init']);

  mkdirp(path.join(ctx.root, 'backlog', 'paused'));
  mkdirp(path.join(ctx.root, 'backlog', 'active'));
  mkdirp(path.join(ctx.root, 'swarmforge', 'scripts'));

  const destScript = path.join(ctx.root, 'swarmforge', 'scripts', 'promote_and_route_next.sh');
  fs.copyFileSync(PROMOTE_SCRIPT_SRC, destScript);
  fs.chmodSync(destScript, 0o755);
  // promotion_gates (BL-663): the chokepoint promote_and_route_next.sh now
  // shells out to for every gate decision — must travel with the copy.
  fs.copyFileSync(GATES_CLI_SRC, path.join(ctx.root, 'swarmforge', 'scripts', 'promotion_gates_cli.bb'));
  fs.copyFileSync(GATES_LIB_SRC, path.join(ctx.root, 'swarmforge', 'scripts', 'promotion_gates_lib.bb'));

  const routeStub = path.join(ctx.root, 'swarmforge', 'scripts', 'route_backlog_to_coder.sh');
  fs.writeFileSync(
    routeStub,
    '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'%s\\n\' "$1" > "${ROUTE_LOG:?missing ROUTE_LOG}"\n',
  );
  fs.chmodSync(routeStub, 0o755);

  ctx.ticketId = TICKET_ID;
  const fixturePath = path.join(ctx.root, 'backlog', 'paused', `${TICKET_ID}-fixture.yaml`);
  fs.writeFileSync(
    fixturePath,
    `id: ${TICKET_ID}\ntitle: "fixture ${TICKET_ID}"\nstatus: paused\npriority: 50\nassigned_to:\n`,
  );
  // Real backlog ticket files are 0644 (git checkout default). `mktemp`
  // defaults to 0600 -- pin the fixture to 0644 so a regression from
  // `cat "$SED_TMP" > "$DEST"` (preserves $DEST's mode) back to
  // `mv "$SED_TMP" "$DEST"` (adopts the temp file's 0600) is observable
  // rather than accidentally matching whatever mode fs.writeFileSync chose.
  fs.chmodSync(fixturePath, 0o644);
  ctx.originalMode = fs.statSync(fixturePath).mode & 0o777;

  git(ctx.root, ['add', 'backlog', 'swarmforge']);
  git(ctx.root, ['commit', '-q', '-m', 'seed fixture paused ticket']);

  ctx.routeLog = path.join(ctx.root, 'route.log');
}

function registerSteps(registry) {
  registry.defineScoped(
    /^a fixture backlog with one eligible paused ticket routed to coder$/,
    (ctx) => {
      initFixture(ctx);
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the host sed is (bsd|gnu)-flavored$/,
    (ctx, flavor) => {
      ctx.sedStubDir = fakeSedDir(flavor);
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^promote_and_route_next\.sh runs$/,
    (ctx) => {
      const res = spawnSync('bash', [path.join(ctx.root, 'swarmforge', 'scripts', 'promote_and_route_next.sh')], {
        cwd: ctx.root,
        encoding: 'utf8',
        env: {
          PATH: `${ctx.sedStubDir}:${process.env.PATH}`,
          HOME: process.env.HOME,
          ROUTE_LOG: ctx.routeLog,
        },
      });
      ctx.result = { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the ticket file sits in backlog\/active with assigned_to rewritten to coder$/,
    (ctx) => {
      const dest = path.join(ctx.root, 'backlog', 'active', `${ctx.ticketId}-fixture.yaml`);
      if (!fs.existsSync(dest)) {
        throw new Error(
          `expected ${ctx.ticketId} to be promoted into backlog/active/, but it is not there. output:\n${combinedOutput(ctx.result)}`,
        );
      }
      const content = fs.readFileSync(dest, 'utf8');
      if (!/^assigned_to:\s*coder\s*$/m.test(content)) {
        throw new Error(`expected assigned_to: coder, got content:\n${content}`);
      }
      const mode = fs.statSync(dest).mode & 0o777;
      if (mode !== ctx.originalMode) {
        throw new Error(
          `expected ${ctx.ticketId}'s mode bits to survive the assigned_to rewrite ` +
            `(${ctx.originalMode.toString(8)} -> ${mode.toString(8)}); the sed fix must edit ` +
            'in place (cat > $DEST), not mv a fresh mktemp file (0600) over it',
        );
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the promotion commit exists$/,
    (ctx) => {
      const log = execFileSync('git', ['log', '--oneline', '-1'], { cwd: ctx.root, encoding: 'utf8' });
      if (!log.includes(`Promote ${ctx.ticketId}`)) {
        throw new Error(`expected the latest commit to be a "Promote ${ctx.ticketId}" commit, got: ${log}`);
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the Work route to coder is sent$/,
    (ctx) => {
      if (!fs.existsSync(ctx.routeLog)) {
        throw new Error(
          `expected route_backlog_to_coder.sh to be invoked (route.log missing). output:\n${combinedOutput(ctx.result)}`,
        );
      }
      const routed = fs.readFileSync(ctx.routeLog, 'utf8').trim();
      if (routed !== ctx.ticketId) {
        throw new Error(`expected route log to name ${ctx.ticketId}, got: ${routed}`);
      }
    },
    FEATURE_NAME,
  );
}

module.exports = { registerSteps };
