'use strict';

// BL-781: dead babysitter wake-runtime files deleted; BL-611 scenario 15 no
// longer vacuous. Drives real path checks, the live bl611 allowlist source,
// a BL-611 scenario-15-only acceptance probe, and salvaged lib test runners.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { isLiveGrepOffender } = require('./lib/bl781LiveGrepOffender');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BL611_STEPS = path.join(REPO_ROOT, 'specs', 'pipeline', 'steps', 'bl611BabysitterdLifecycleSteps.js');
const RUN_ACCEPTANCE = path.join(REPO_ROOT, 'specs', 'pipeline', 'scripts', 'run_acceptance.sh');
const BL611_FEATURE = path.join(
  REPO_ROOT,
  'specs',
  'features',
  'BL-611-deterministic-babysitterd-managed-by-swarm-lifecycle.feature'
);
const START_SWARM_SH = path.join(REPO_ROOT, 'start-swarm.sh');
const STOP_SWARM_SH = path.join(REPO_ROOT, 'stop-swarm.sh');
const SWARM_ENSURE_BB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'swarm_ensure.bb');

const FEATURE = 'Dead babysitter wake-runtime files are deleted and scenario 15 is no longer vacuous';

const DELETED_WAKE_RUNTIME = [
  'swarmforge/scripts/babysitter_lib.bb',
  'swarmforge/scripts/babysitter_enqueue_wake.sh',
  'swarmforge/scripts/babysitter_assess.bb',
];

const DELETED_BASENAMES = DELETED_WAKE_RUNTIME.map((p) => path.basename(p));

const FORBIDDEN_RETIRED_PATTERNS = [
  /babysitter_lib\.bb/i,
  /babysitter_enqueue_wake\.sh/i,
  /babysitter_assess\.bb(?!_lib)/i,
];

function loadBl611Scan() {
  const src = fs.readFileSync(BL611_STEPS, 'utf8');
  const start = src.indexOf('function isAllowedBabysitterMatch');
  const end = src.indexOf('function registerSteps(registry)');
  const { spawnSync: shSpawn } = require('node:child_process');
  const evalFn = new Function(
    'fs',
    'path',
    'spawnSync',
    'REPO_ROOT',
    `${src.slice(start, end)}\nreturn { scanRepoForBabysitter };`
  );
  return evalFn(fs, path, shSpawn, REPO_ROOT);
}

function ensureState(ctx) {
  if (!ctx.bl781) ctx.bl781 = {};
  return ctx.bl781;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the repo at the parcel commit$/, () => {
    // Parcel commit is the checked-out worktree — no checkout dance needed.
  });

  scoped(/^the tree is searched for "([^"]+)"$/, (ctx, relPath) => {
    ensureState(ctx).lastPath = relPath;
    ensureState(ctx).lastExists = fs.existsSync(path.join(REPO_ROOT, relPath));
  });

  scoped(/^that path does not exist$/, (ctx) => {
    const st = ensureState(ctx);
    if (st.lastExists) {
      throw new Error(`expected absent: ${st.lastPath}`);
    }
  });

  scoped(/^that path exists$/, (ctx) => {
    const st = ensureState(ctx);
    if (!st.lastExists) {
      throw new Error(`expected present: ${st.lastPath}`);
    }
  });

  scoped(/^the BL-611 scenario 15 step handler allowlist at the parcel commit$/, (ctx) => {
    ensureState(ctx).bl611Source = fs.readFileSync(BL611_STEPS, 'utf8');
  });

  scoped(/^the allowlist paths are read$/, (ctx) => {
    const src = ensureState(ctx).bl611Source;
    const match = src.match(
      /salvaged pure libraries this ticket explicitly KEEPs[\s\S]*?\[\s*([\s\S]*?)\s*\]/
    );
    if (!match) {
      throw new Error('could not locate salvaged-library allowlist in bl611BabysitterdLifecycleSteps.js');
    }
    const paths = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    ensureState(ctx).allowlistPaths = paths;
  });

  scoped(/^the allowlist does not name any deleted wake-runtime babysitter file$/, (ctx) => {
    const paths = ensureState(ctx).allowlistPaths || [];
    for (const deleted of DELETED_WAKE_RUNTIME) {
      if (paths.includes(deleted)) {
        throw new Error(`allowlist still names deleted file: ${deleted}`);
      }
    }
  });

  scoped(/^BL-611 scenario 15 is run against the parcel commit$/, (ctx) => {
    const { scanRepoForBabysitter } = loadBl611Scan();
    ensureState(ctx).bl611Scan = scanRepoForBabysitter();
  });

  scoped(/^every step passes$/, (ctx) => {
    const scan = ensureState(ctx).bl611Scan;
    if (!scan) {
      throw new Error('BL-611 scan missing — run scenario 15 probe first');
    }
    if (scan.forbidden.length > 0) {
      throw new Error(
        `retired wake-runtime artifacts still present:\n${scan.forbidden.join('\n')}`
      );
    }
    for (const deleted of DELETED_WAKE_RUNTIME) {
      if (scan.offenders.includes(deleted)) {
        throw new Error(`deleted wake-runtime file still matched scan: ${deleted}`);
      }
    }
  });

  scoped(/^"([^"]+)" reports ALL PASS$/, (ctx, runnerRel) => {
    const runnerPath = path.join(REPO_ROOT, runnerRel);
    if (runnerRel.endsWith('.sh')) {
      const result = spawnSync('bash', [runnerPath], { encoding: 'utf8', cwd: REPO_ROOT });
      if (result.status !== 0 || !/ALL PASS/i.test(`${result.stdout}${result.stderr}`)) {
        throw new Error(`${runnerRel} failed:\n${result.stdout}${result.stderr}`);
      }
      return;
    }
    const result = spawnSync('bb', [runnerPath], { encoding: 'utf8', cwd: REPO_ROOT });
    const out = `${result.stdout}${result.stderr}`;
    if (result.status !== 0 || !/(ALL PASS|: ok\b)/i.test(out)) {
      throw new Error(`${runnerRel} failed:\n${out}`);
    }
  });

  scoped(/^\.\/start-swarm\.sh, \.\/stop-swarm\.sh, and \.\/swarm ensure run$/, (ctx) => {
    const st = ensureState(ctx);
    st.startHelp = spawnSync('bash', [START_SWARM_SH, '--help'], { encoding: 'utf8' });
    st.stopHelp = spawnSync('bash', [STOP_SWARM_SH, '--help'], { encoding: 'utf8' });
    const ensureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl781-ensure-'));
    st.ensureRun = spawnSync('bb', [SWARM_ENSURE_BB, ensureRoot], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SWARM_ENSURE_EXTENSION_CHECK_CMD: 'true',
        SWARM_ENSURE_SUPERVISOR_CMD: 'true',
        SWARM_ENSURE_OPERATOR_CMD: 'true',
        SWARM_ENSURE_FRONT_DESK_CMD: 'true',
        SWARM_ENSURE_BABYSITTERD_CMD: 'true',
      },
    });
    try {
      fs.rmSync(ensureRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  scoped(/^none of them error on a missing reference to a removed file$/, (ctx) => {
    const st = ensureState(ctx);
    for (const [label, result] of [
      ['start-swarm.sh --help', st.startHelp],
      ['stop-swarm.sh --help', st.stopHelp],
      ['swarm ensure', st.ensureRun],
    ]) {
      const out = (result.stdout || '') + (result.stderr || '');
      for (const pattern of FORBIDDEN_RETIRED_PATTERNS) {
        if (pattern.test(out)) {
          throw new Error(`${label} output references a retired file (${pattern}):\n${out}`);
        }
      }
      if (/No such file or directory/.test(out) && /babysit/i.test(out)) {
        throw new Error(`${label} errored on a missing babysitter-related file:\n${out}`);
      }
    }
  });

  scoped(/^a repo-wide search is run for "([^"]+)" excluding history and docs$/, (ctx, basename) => {
    const result = spawnSync(
      'git',
      [
        'grep',
        '-l',
        basename,
        '--',
        '.',
        ':(exclude)backlog/**',
        ':(exclude)docs/**',
      ],
      { encoding: 'utf8', cwd: REPO_ROOT }
    );
    ensureState(ctx).grepBasename = basename;
    ensureState(ctx).grepMatches = (result.stdout || '').split('\n').filter(Boolean);
  });

  scoped(
    /^every match is absent or is only a historical backlog or docs reference$/,
    (ctx) => {
      const st = ensureState(ctx);
      const liveOffenders = st.grepMatches.filter((rel) => isLiveGrepOffender(rel));
      if (liveOffenders.length > 0) {
        throw new Error(
          `live references to ${st.grepBasename} outside history/docs:\n${liveOffenders.join('\n')}`
        );
      }
    }
  );
}

module.exports = { registerSteps };
