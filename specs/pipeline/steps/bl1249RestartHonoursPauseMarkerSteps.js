'use strict';

// BL-1249: the expeditor's restart phase must consult the operator pause
// marker (.swarmforge/operator/control-pause.json) before running the start
// command, and report a hold as its own, loud outcome — never silently, and
// never as the caller-declined :not-attempted outcome.
//
// Drives the REAL expedite_cli.bb --restart-only path against a real fixture
// root and a real marker file — never a JS reimplementation of
// restart-hold-verdict.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_cli.bb');

const FEATURE_NAME =
  'BL-1249 the expeditor declines to restart the swarm while an operator hold is in force';

function markerPath(root) {
  return path.join(root, '.swarmforge', 'operator', 'control-pause.json');
}

function writeMarker(root, text) {
  const p = markerPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (text === undefined) {
    if (fs.existsSync(p)) fs.rmSync(p);
    return;
  }
  fs.writeFileSync(p, text);
}

// The "marker" example values, matched against the feature file's literal
// vocabulary (bare in the Outline, quoted in scenarios 01/02/04 — the same
// step handles both per the feature's own IR-DRY note).
function markerTextFor(word) {
  switch (word) {
    case 'absent':
      return undefined;
    case 'positively inactive':
      return JSON.stringify({ active: false });
    case 'holding':
      return JSON.stringify({ active: true });
    case 'malformed':
      return '[1,2,3]';
    case 'truncated':
      // A genuine active marker's own text, cut short — a corruption of a
      // real hold, never an independently-drawn string.
      return JSON.stringify({ active: true, untilMs: 999999 }).slice(0, 10);
    default:
      throw new Error(`bl1249: unrecognized marker value "${word}"`);
  }
}

function runRestartOnly(ctx, extraArgs) {
  const sentinel = path.join(ctx.root, `sentinel-${extraArgs.join('') || 'main'}`);
  const res = spawnSync('bb', [CLI, '--restart-only', ctx.root, ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, EXPEDITE_START_CMD: `touch ${JSON.stringify(sentinel)}` },
    timeout: 30_000,
  });
  if (res.status !== 0) {
    throw new Error(`--restart-only exited ${res.status}:\n${res.stdout}${res.stderr}`);
  }
  return { report: JSON.parse(res.stdout.trim()), sentinel };
}

const FIXTURE_PREFIX = 'bl1249-restart-hold-';

// BL-971: sweep stale fixture dirs by prefix BEFORE the run too — a killed
// prior run traps nothing in its own finally.
function sweepStaleFixtures() {
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (name.startsWith(FIXTURE_PREFIX)) {
      fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
    }
  }
}

function cleanupRoot(ctx) {
  if (ctx.root) {
    fs.rmSync(ctx.root, { recursive: true, force: true });
    ctx.root = null;
  }
}

function registerSteps(registry) {
  registry.defineScoped(
    /^an expedite run whose stages have all passed$/,
    (ctx) => {
      sweepStaleFixtures();
      ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
      ctx.ticketVerdict = 'done';
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^a stubbed start command that records whether it ran$/,
    () => {
      // Handled inline by runRestartOnly's EXPEDITE_START_CMD per invocation
      // (each Then step checks its own sentinel).
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the operator pause marker is "?([a-z ]+?)"?$/,
    (ctx, word) => {
      ctx.markerWord = word;
      writeMarker(ctx.root, markerTextFor(word));
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the expeditor reaches its restart phase$/,
    (ctx) => {
      ctx.mainRun = runRestartOnly(ctx, []);
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the start command (does not run|runs)$/,
    (ctx, outcome) => {
      try {
        const ran = fs.existsSync(ctx.mainRun.sentinel);
        if (outcome === 'runs' && !ran) {
          throw new Error(`expected start command to run for marker "${ctx.markerWord}", but sentinel is absent`);
        }
        if (outcome === 'does not run' && ran) {
          throw new Error(`expected start command NOT to run for marker "${ctx.markerWord}", but sentinel exists`);
        }
      } finally {
        cleanupRoot(ctx);
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the run report names the marker that caused the hold$/,
    (ctx) => {
      const p = ctx.mainRun.report['marker-path'];
      if (typeof p !== 'string' || !p.includes('control-pause.json')) {
        throw new Error(`expected run report to name the marker path, got: ${JSON.stringify(ctx.mainRun.report)}`);
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the reported outcome differs from the outcome of a run invoked with "--no-restart"$/,
    (ctx) => {
      try {
        const noRestartRun = runRestartOnly(ctx, ['--no-restart']);
        if (noRestartRun.report.outcome !== 'not-attempted') {
          throw new Error(`expected --no-restart outcome "not-attempted", got: ${JSON.stringify(noRestartRun.report)}`);
        }
        if (ctx.mainRun.report.outcome === noRestartRun.report.outcome) {
          throw new Error(
            `expected a held outcome to differ from --no-restart's, both read "${ctx.mainRun.report.outcome}"`,
          );
        }
      } finally {
        cleanupRoot(ctx);
      }
    },
    FEATURE_NAME,
  );

  registry.defineScoped(
    /^the ticket verdict for the run is still a pass$/,
    (ctx) => {
      try {
        // run-result never lets the restart half retract the ticket half —
        // proven directly against the pure combinator, with the SAME held
        // outcome this scenario's restart phase actually produced.
        const bbSrc = `
(load-file "${path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_lib.bb')}")
(println (:ticket (expedite-lib/run-result {:ticket :done :restart :held})))
`;
        const res = spawnSync('bb', ['-e', bbSrc], { encoding: 'utf8', timeout: 15_000 });
        if (res.status !== 0 || res.stdout.trim() !== ':done') {
          throw new Error(`expected ticket verdict "done" to survive a held restart, got:\n${res.stdout}${res.stderr}`);
        }
        if (ctx.mainRun.report.outcome !== 'held') {
          throw new Error(`expected this scenario's own run to be held, got: ${JSON.stringify(ctx.mainRun.report)}`);
        }
      } finally {
        cleanupRoot(ctx);
      }
    },
    FEATURE_NAME,
  );
}

module.exports = { registerSteps };
